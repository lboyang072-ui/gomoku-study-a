export const EXPERIMENT_STORAGE_KEY = 'gomoku-study-a.v1';
export const EXPERIMENT_PROTOCOL_VERSION = 'study-a-v1/2026-11-05-r1';
export const FORM_A_ORDER = ['DEF-A04','DEF-B06','DEF-C01','ATT-PHOTO-02','DEF-C03','DEF-D01','DEF-D03','DEF-D05','DEF-E04','DEF-D09'];

const clone = value => structuredClone(value);
const stageFor = item => item.stage;
const stages = ['baseline','practice','posttest'];

function seedNumber(seed) {
  if (Number.isInteger(seed)) return seed >>> 0;
  let x=2166136261;
  for(const c of String(seed??'')) x=Math.imul(x^c.charCodeAt(0),16777619)>>>0;
  return x>>>0;
}
function pairOrder(seed, block) {
  let x=(seed ^ Math.imul(block+1,0x9e3779b1))>>>0;
  x^=x<<13; x^=x>>>17; x^=x<<5;
  return (x&1)?['AI','control']:['control','AI'];
}
function emptyItem(item) {
  return {
    order:item.order,stage:item.stage,item_id:item.id,side:item.side_to_move,task_type:item.task.type,
    status:'not_reached',initial_move:null,initial_correct:null,initial_ms:null,
    final_move:null,final_correct:null,review_ms:null,total_ms:null,
    started_at:null,initial_submitted_at:null,advice_shown_at:null,advice_version:null,
    submitted_at:null,timeout:false,timeout_phase:null,processing_delay_ms:0,timing_valid:true,events:[],
  };
}

export function createExperimentSession({study,advice,storage,clock={wallNow:()=>Date.now(),monoNow:()=>performance.now()},uuid=()=>crypto.randomUUID(),randomSeed}={}) {
  if(!study||study.form_id!=='A'||!Array.isArray(study.items)) throw new Error('A套材料不可用');
  if(study.items.length!==10||study.items.map(x=>x.id).join('|')!==FORM_A_ORDER.join('|')) throw new Error('A套题序/题量不匹配');
  const adviceById=new Map((advice?.items??[]).map(x=>[x.item_id,x]));
  let persisted=true,issues=[],data={schema_version:1,form_id:'A',protocol_version:EXPERIMENT_PROTOCOL_VERSION,runs:[],active_run:null,allocation_state:null};
  const nowMs=()=>Number(clock.wallNow());
  const iso=ms=>new Date(ms).toISOString();
  const pushIssue=message=>{if(!issues.includes(message))issues.push(message);};
  const validStoredRun=run=>run&&run.form_id==='A'&&run.protocol_version===EXPERIMENT_PROTOCOL_VERSION&&run.material_version===study.material_version&&run.rules_version===study.rules_version&&run.study_sha256===study.study_sha256&&run.advice_sha256===study.advice_sha256&&(run.ui_language===undefined||['zh-CN','en'].includes(run.ui_language))&&(run.pair_id===undefined||run.pair_id===null||(run.mode==='pilot'&&run.allocation_kind==='host_link'&&typeof run.pair_id==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/.test(run.pair_id)))&&Array.isArray(run.items)&&run.items.length===10&&run.items.map(x=>x.item_id).join('|')===FORM_A_ORDER.join('|');
  try{
    const raw=storage.getItem(EXPERIMENT_STORAGE_KEY);
    if(raw!==null){
      const parsed=JSON.parse(raw);
      if(!parsed||parsed.schema_version!==1||parsed.form_id!=='A'||!Array.isArray(parsed.runs)||!(parsed.active_run===null||parsed.active_run&&Array.isArray(parsed.active_run.items))) throw new Error('A套记录格式不受支持');
      if(parsed.protocol_version!==EXPERIMENT_PROTOCOL_VERSION) throw new Error('A套记录版本不匹配；旧记录未覆盖，请先导出并联系工作人员。');
      if(parsed.runs.some(run=>!validStoredRun(run))||(parsed.active_run&&!validStoredRun(parsed.active_run)))throw new Error('A套运行材料/hash不匹配；旧记录未覆盖，请先导出并联系工作人员。');
      data=parsed;
    }
  }catch(error){persisted=false;pushIssue(`本机记录不可读，原数据未覆盖：${error.message}`);}
  if(!data.allocation_state)data.allocation_state={seed:seedNumber(randomSeed??uuid()),next_index:0,blocks:[]};

  function save(){
    if(!persisted)return false;
    try{storage.setItem(EXPERIMENT_STORAGE_KEY,JSON.stringify(data));return true;}
    catch(error){persisted=false;pushIssue(`本机存储失败，当前只保存在内存：${error.message}。请导出并联系工作人员。`);return false;}
  }
  function currentItem(){const run=data.active_run;return run&&run.status==='in_progress'?run.items[run.current_index]??null:null;}
  function addRunEvent(name,details={}){const run=data.active_run;if(!run)return;const e={event:name,at:iso(nowMs()),details:clone(details)};run.events.push(e);const item=currentItem();if(item)item.events.push(e);}
  function clockAnomaly(run,{resetMono=false}={}){
    const now=nowMs(),mono=Number(clock.monoNow()),last=run.last_wall_ms,lastMono=run.last_mono_ms;
    const wallBack=Number.isFinite(last)&&now<last;
    const drift=!resetMono&&Number.isFinite(last)&&Number.isFinite(lastMono)&&Number.isFinite(mono)&&Math.abs((now-last)-(mono-lastMono))>5000;
    if(wallBack||drift){
      const first=!run.clock_anomaly;run.clock_anomaly=true;run.timing_valid=false;
      const rec=currentItem();if(rec){rec.timing_valid=false;rec.initial_ms=null;rec.review_ms=null;rec.total_ms=null;}
      if(first){pushIssue('检测到系统时钟异常；受影响题目的用时不会作为有效H2数据。');addRunEvent('clock_anomaly',{previous_wall_ms:last,current_wall_ms:now,wall_back:wallBack,wall_monotonic_drift_ms:drift?(now-last)-(mono-lastMono):null});}
    }
    run.last_wall_ms=now;run.last_mono_ms=mono;return now;
  }
  function startCurrent(){
    const run=data.active_run;if(!run||run.status!=='in_progress'||run.current_index>=10){if(run&&run.status==='in_progress'){run.status='questionnaire';run.phase='questionnaire';run.ended_items_at=iso(nowMs());}return;}
    const rec=run.items[run.current_index];if(rec.status!=='not_reached')return;
    const start=clockAnomaly(run),stage=rec.stage,duration=stage==='practice'?90000:60000;
    rec.status='in_progress';rec.started_at=iso(start);rec.deadline_at=start+duration;rec.timing_valid=!run.clock_anomaly;rec.processing_delay_ms=0;
    rec.initial_deadline_at=stage==='practice'?start+45000:null;
    run.phase=stage==='practice'?'initial':'final';
    addRunEvent('item_started',{item_id:rec.item_id,stage,deadline_at:rec.deadline_at,initial_deadline_at:rec.initial_deadline_at});save();
  }
  function advance(){const run=data.active_run;if(!run)return;run.current_index++;if(run.current_index>=10){run.phase='questionnaire';run.status='questionnaire';run.questionnaire_started_at=iso(nowMs());}else startCurrent();save();}
  function timeoutCurrent(phase){const run=data.active_run,rec=currentItem();if(!run||!rec)return null;const now=clockAnomaly(run);const deadline=phase==='initial'?rec.initial_deadline_at:rec.deadline_at;const stoppedAt=Math.min(now,deadline);rec.timeout=true;rec.timeout_phase=phase;rec.status='timeout';rec.submitted_at=iso(now);rec.processing_delay_ms=Math.max(0,now-deadline);rec.total_ms=run.clock_anomaly?null:Math.max(0,stoppedAt-Date.parse(rec.started_at));if(rec.stage==='practice'&&run.phase==='review'&&rec.review_started_at)rec.review_ms=run.clock_anomaly?null:Math.max(0,stoppedAt-Date.parse(rec.review_started_at));rec.final_move=null;rec.final_correct=null;addRunEvent('timeout',{item_id:rec.item_id,phase,processing_delay_ms:rec.processing_delay_ms});advance();return view();}
  function expireIfNeeded(){const run=data.active_run,rec=currentItem();if(!run||!rec||rec.status!=='in_progress')return false;const now=nowMs();if(rec.stage==='practice'&&run.phase==='initial'&&now>=rec.initial_deadline_at){timeoutCurrent('initial');return true;}if(now>=rec.deadline_at){timeoutCurrent(run.phase==='review'?'final':'answer');return true;}return false;}
  function allocatePilot(){
    const a=data.allocation_state,index=a.next_index,block=Math.floor(index/2),slot=index%2;
    let entry=a.blocks.find(x=>x.block_index===block);
    if(!entry){const order=pairOrder(a.seed,block);entry={block_index:block,block_id:`A-block-${String(block+1).padStart(3,'0')}`,order,consumed:0};a.blocks.push(entry);}
    const condition=entry.order[slot];entry.consumed=Math.max(entry.consumed,slot+1);a.next_index++;
    return {condition,allocation_id:`${entry.block_id}-${slot+1}`,allocation_block_id:entry.block_id,allocation_order:[...entry.order],allocation_slot:slot+1,allocation_seed:a.seed};
  }
  function view(){return {persisted,issues:[...issues],allocation_state:clone(data.allocation_state),runs:clone(data.runs),active_run:data.active_run?clone(data.active_run):null,current_item:currentItem()?clone(study.items[data.active_run.current_index]):null,advice:currentItem()&&currentItem().stage==='practice'&&data.active_run?.condition==='AI'&&data.active_run?.phase==='review'?clone(adviceById.get(currentItem().item_id)??null):null};}
  function beginRun({mode='demo',manual_condition='control',consent=false,allocation_kind=null,pair_id=null,ui_language='zh-CN'}={}){
    if(data.active_run)throw new Error('请先结束或退出上一位参与者，并归档后再开始下一位');
    if(!consent)throw new Error('需要先确认知情同意');
    if(!['demo','pilot'].includes(mode))throw new Error('未知运行模式');
    if(!['zh-CN','en'].includes(ui_language))throw new Error('运行语言无效');
    if(pair_id!==null&&(typeof pair_id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/.test(pair_id)))throw new Error('配对编号仅允许1到40位字母、数字、下划线和连字符');
    if(allocation_kind==='host_link'&&mode!=='pilot')throw new Error('主持人链接必须使用pilot模式');
    if(pair_id!==null&&(mode!=='pilot'||allocation_kind!=='host_link'))throw new Error('配对编号只用于主持人链接试跑');
    if(mode==='pilot'&&!persisted)throw new Error('本机存储不可用；不能启动pilot运行');
    let assignment;
    if(mode==='demo'){
      if(!['AI','control'].includes(manual_condition))throw new Error('演示模式请选择条件');
      assignment={condition:manual_condition,allocation_id:`manual-demo-${uuid()}`,allocation_kind:'manual_demo'};
    }else if(allocation_kind==='host_link'){
      if(!['AI','control'].includes(manual_condition))throw new Error('主持人链接条件无效');
      assignment={condition:manual_condition,allocation_id:`host-link-${pair_id??uuid()}`,allocation_kind:'host_link'};
    }else assignment={...allocatePilot(),allocation_kind:'paired_local_block'};
    const id=uuid(),now=nowMs();
    data.active_run={schema_version:1,app_version:'1.0.0-local',protocol_version:EXPERIMENT_PROTOCOL_VERSION,protocol_sha256:study.protocol_sha256,material_version:study.material_version,rules_version:study.rules_version,study_sha256:study.study_sha256,advice_sha256:study.advice_sha256,advice_version:advice?.advice_version??null,form_id:'A',participant_id:`P-${String(id).replaceAll('-','').slice(0,10)}`,run_id:id,mode,ui_language,condition:assignment.condition,allocation_id:assignment.allocation_id,allocation_kind:assignment.allocation_kind,pair_id:pair_id??null,allocation_seed:assignment.allocation_seed??null,allocation_block_id:assignment.allocation_block_id??null,allocation_order:assignment.allocation_order??null,allocation_slot:assignment.allocation_slot??null,consent:{accepted:true,accepted_at:iso(now)},status:'in_progress',phase:'baseline',current_index:0,started_at:iso(now),ended_at:null,items:study.items.map(emptyItem),questionnaire:null,questionnaire_draft:null,events:[],last_wall_ms:now,last_mono_ms:Number(clock.monoNow()),clock_anomaly:false,timing_valid:true};
    addRunEvent('run_started',{mode,condition:assignment.condition,allocation_id:assignment.allocation_id,allocation_kind:assignment.allocation_kind,pair_id:pair_id??null});
    startCurrent();if(!save()&&mode==='pilot'){data.active_run=null;throw new Error('无法持久化pilot运行，未开始参与者流程');}return view();
  }
  function selectMove(pos){
    const run=data.active_run,rec=currentItem();if(expireIfNeeded())throw new Error('本题时间已到，已自动进入下一题');if(!run||!rec||rec.status!=='in_progress')throw new Error('当前没有可作答的题目');
    const item=study.items[run.current_index];
    if(!/^[A-O](?:[1-9]|1[0-5])$/.test(pos)||item.board.pieces.some(p=>p.pos===pos))throw new Error('请选择棋盘内空点');
    if(!item.board.pieces.some(p=>p.pos===pos)){
      rec.selected_move=pos;rec.last_selection_at=iso(clockAnomaly(run));save();return view();
    }
    throw new Error('请选择棋盘内空点');
  }
  function confirmInitial(score){
    const run=data.active_run,rec=currentItem();if(!run||!rec||rec.stage!=='practice'||run.phase!=='initial')throw new Error('当前不是练习初选阶段');
    if(expireIfNeeded())return view();if(!rec.selected_move)throw new Error('请先选择初选落点');
    if(typeof score!=='function')throw new Error('初选评分器不可用');const initial=score(study.items[run.current_index],rec.selected_move);if(!initial?.answer||initial.valid_position!==true)throw new Error('核心未能记录初选；此题未锁定');
    const now=clockAnomaly(run);if(now>=rec.initial_deadline_at){timeoutCurrent('initial');return view();}
    rec.initial_move=rec.selected_move;rec.initial_correct=initial.answer.correct;rec.initial_submitted_at=iso(now);rec.timing_valid=!run.clock_anomaly;rec.initial_ms=run.clock_anomaly?null:Math.max(0,now-Date.parse(rec.started_at));run.phase='review';rec.phase='review';rec.review_started_at=iso(now);rec.selected_move=rec.initial_move;
    rec.advice_shown_at=run.condition==='AI'?iso(now):null;rec.advice_version=run.condition==='AI'?advice?.advice_version??null:null;
    addRunEvent('initial_locked',{item_id:rec.item_id,initial_move:rec.initial_move});if(run.condition==='AI')addRunEvent('advice_shown',{item_id:rec.item_id,advice_version:rec.advice_version});else addRunEvent('control_review_prompt',{item_id:rec.item_id});save();return view();
  }
  function submitFinal(score){
    const run=data.active_run,rec=currentItem();if(!run||!rec||rec.status!=='in_progress')throw new Error('当前没有可提交结果');if(expireIfNeeded())return view();if(!rec.selected_move)throw new Error('请先选择最终落点');
    if((rec.stage==='practice'&&run.phase!=='review')||(rec.stage!=='practice'&&run.phase!=='final'))throw new Error('当前阶段不可提交最终选择');
    const now=clockAnomaly(run);if(now>=rec.deadline_at){timeoutCurrent(run.phase==='review'?'final':'answer');return view();}
    const item=study.items[run.current_index];const result=score(item,rec.selected_move);if(!result?.answer||result.valid_position!==true)throw new Error('规则核心未能评分；此题未记录');
    if(rec.stage==='practice'){
      const initial=score(item,rec.initial_move);if(!initial?.answer||initial.valid_position!==true||initial.answer.correct!==rec.initial_correct)throw new Error('初选复算不一致；此题未记录');
      rec.changed=rec.initial_move!==rec.selected_move;
      rec.review_ms=run.clock_anomaly?null:Math.max(0,now-Date.parse(rec.review_started_at));
    }else{rec.initial_move=null;rec.initial_correct=null;rec.initial_ms=null;rec.review_ms=null;rec.changed=null;}
    rec.final_move=rec.selected_move;rec.final_correct=result.answer.correct;rec.final_game_status=result.game_state.status;rec.final_winner=result.game_state.winner;
    rec.submitted_at=iso(now);rec.processing_delay_ms=0;rec.timing_valid=!run.clock_anomaly;rec.total_ms=run.clock_anomaly?null:Math.max(0,now-Date.parse(rec.started_at));rec.status='submitted';rec.selected_move=null;
    addRunEvent('final_submitted',{item_id:rec.item_id,final_move:rec.final_move});advance();return view();
  }
  function setQuestionnaire(values){
    const run=data.active_run;if(!run||run.status!=='questionnaire')throw new Error('请先完成10道题');
    const allowed=['gomoku_experience','perceived_difficulty','review_helpfulness','ai_trust','comment'];
    const input=values??run.questionnaire_draft??{},q={};for(const key of allowed)q[key]=input[key]??null;
    for(const key of ['perceived_difficulty','review_helpfulness','ai_trust'])if(q[key]!==null&&(!Number.isInteger(q[key])||q[key]<1||q[key]>5))throw new Error(`${key}须为1到5或留空`);
    if(run.condition!=='AI')q.ai_trust=null;run.questionnaire=q;run.questionnaire_draft=null;run.questionnaire_draft_saved_at=null;run.status='complete';run.phase='complete';run.ended_at=iso(clockAnomaly(run));addRunEvent('run_completed');save();return view();
  }
  function updateQuestionnaireDraft(values){const run=data.active_run;if(!run||run.status!=='questionnaire')throw new Error('问卷当前未开放');const draft={gomoku_experience:values?.gomoku_experience??null,perceived_difficulty:values?.perceived_difficulty??null,review_helpfulness:values?.review_helpfulness??null,ai_trust:run.condition==='AI'?(values?.ai_trust??null):null,comment:values?.comment??null};for(const key of ['perceived_difficulty','review_helpfulness','ai_trust'])if(draft[key]!==null&&(!Number.isInteger(draft[key])||draft[key]<1||draft[key]>5))throw new Error(`${key}须为1到5或留空`);const wasEmpty=!run.questionnaire_draft;run.questionnaire_draft=draft;run.questionnaire_draft_saved_at=iso(nowMs());if(wasEmpty)addRunEvent('questionnaire_draft_saved',{fields:Object.keys(draft).filter(k=>draft[k]!==null)});save();return view();}
  function withdraw(){const run=data.active_run;if(!run||!['in_progress','questionnaire'].includes(run.status))throw new Error('当前没有可退出的运行');run.status='withdrawn';run.phase='withdrawn';run.ended_at=iso(clockAnomaly(run));addRunEvent('participant_withdrew');save();return view();}
  function visibilityChanged(hidden){const run=data.active_run;if(!run||!['in_progress','questionnaire'].includes(run.status))return view();clockAnomaly(run);addRunEvent('visibility_changed',{hidden:Boolean(hidden)});save();return view();}
  function tick(){const run=data.active_run;if(run&&['in_progress','questionnaire'].includes(run.status))clockAnomaly(run);expireIfNeeded();return view();}
  function nextParticipant(){const run=data.active_run;if(!run||!['complete','withdrawn'].includes(run.status))throw new Error('上一位参与者尚未结束');data.runs.push(clone(run));data.active_run=null;save();return view();}
  function exportData(){
    const runs=[...clone(data.runs),...(data.active_run?[clone(data.active_run)]:[])],items=[];
    for(const run of runs)for(const item of run.items)items.push({...item,item_events:clone(item.events),participant_id:run.participant_id,run_id:run.run_id,form_id:run.form_id,ui_language:run.ui_language??'zh-CN',condition:run.condition,allocation_id:run.allocation_id,allocation_kind:run.allocation_kind,pair_id:run.pair_id??null,allocation_seed:run.allocation_seed,allocation_block_id:run.allocation_block_id,allocation_order:run.allocation_order,allocation_slot:run.allocation_slot,mode:run.mode,run_status:run.status,consent_accepted:run.consent?.accepted??false,run_started_at:run.started_at,run_ended_at:run.ended_at,run_events:clone(run.events),survey_gomoku_experience:run.questionnaire?.gomoku_experience??run.questionnaire_draft?.gomoku_experience??null,survey_perceived_difficulty:run.questionnaire?.perceived_difficulty??run.questionnaire_draft?.perceived_difficulty??null,survey_review_helpfulness:run.questionnaire?.review_helpfulness??run.questionnaire_draft?.review_helpfulness??null,survey_ai_trust:run.questionnaire?.ai_trust??run.questionnaire_draft?.ai_trust??null,survey_comment:run.questionnaire?.comment??run.questionnaire_draft?.comment??null,app_version:run.app_version,protocol_version:run.protocol_version,protocol_sha256:run.protocol_sha256,material_version:run.material_version,rules_version:run.rules_version,study_sha256:run.study_sha256,advice_sha256:run.advice_sha256,advice_version:run.advice_version});
    return{schema_version:'gomoku-study-export/v1',exported_at:iso(nowMs()),form_id:'A',allocation_state:clone(data.allocation_state),runs,items};
  }
  function exportCsv(){
    const columns=['participant_id','run_id','form_id','ui_language','condition','allocation_id','allocation_kind','pair_id','allocation_seed','allocation_block_id','allocation_order','allocation_slot','mode','run_status','consent_accepted','run_started_at','run_ended_at','run_events','app_version','protocol_version','protocol_sha256','material_version','rules_version','study_sha256','advice_sha256','advice_version','order','stage','item_id','side','task_type','status','initial_move','initial_correct','initial_ms','initial_submitted_at','initial_deadline_at','advice_shown_at','final_move','final_correct','review_ms','total_ms','deadline_at','timeout','timeout_phase','processing_delay_ms','timing_valid','started_at','submitted_at','item_events','survey_gomoku_experience','survey_perceived_difficulty','survey_review_helpfulness','survey_ai_trust','survey_comment'];
    const quote=v=>{let s=Array.isArray(v)||v&&typeof v==='object'?JSON.stringify(v):String(v??'');if(/^[\s]*[=+\-@]/.test(s)||/^[\t\r]/.test(s))s="'"+s;return `"${s.replaceAll('"','""')}"`;};
    return [columns.map(quote).join(','),...exportData().items.map(row=>columns.map(k=>quote(row[k])).join(','))].join('\r\n')+'\r\n';
  }
  function viewWithTimer(){tick();const v=view(),rec=v.active_run?.items[v.active_run.current_index]??null;return {...v,time_remaining_ms:rec?.deadline_at?Math.max(0,rec.deadline_at-nowMs()):null,initial_remaining_ms:rec?.initial_deadline_at&&v.active_run.phase==='initial'?Math.max(0,rec.initial_deadline_at-nowMs()):null};}
  function resume(){const run=data.active_run;if(!run||!['in_progress','questionnaire'].includes(run.status))return;const now=nowMs(),previous=run.last_wall_ms;if(Number.isFinite(previous)&&now<previous){run.clock_anomaly=true;run.timing_valid=false;const rec=currentItem();if(rec){rec.timing_valid=false;rec.initial_ms=null;rec.review_ms=null;rec.total_ms=null;}pushIssue('检测到刷新前系统时钟回拨；受影响时长无效并已标记。');addRunEvent('clock_anomaly',{previous_wall_ms:previous,current_wall_ms:now,source:'reload'});}run.last_wall_ms=now;run.last_mono_ms=Number(clock.monoNow());addRunEvent('reload',{current_index:run.current_index,deadline_at:currentItem()?.deadline_at??null});if(run.status==='in_progress')expireIfNeeded();save();}
  resume();
  return {get persisted(){return persisted;},get issues(){return [...issues];},view,viewWithTimer,beginRun,selectMove,confirmInitial,submitFinal,updateQuestionnaireDraft,setQuestionnaire,withdraw,visibilityChanged,tick,nextParticipant,exportData,exportCsv,storageKey:EXPERIMENT_STORAGE_KEY};
}
