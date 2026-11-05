import { createExperimentSession } from './experiment-session.mjs';
import { evaluate_move } from './engine/engine.mjs';

const $=s=>document.querySelector(s);
const ui={notice:$('#notice'),toast:$('#toast'),fatal:$('#fatal'),fatalMessage:$('#fatal-message'),start:$('#start-panel'),hostReady:$('#host-ready-panel'),run:$('#run-panel'),questionnaire:$('#questionnaire'),complete:$('#complete-panel'),mode:()=>document.querySelector('input[name="mode"]:checked')?.value??'demo',condition:()=>document.querySelector('input[name="condition"]:checked')?.value??'control',consent:$('#consent'),startButton:$('#start-run'),startModePill:$('#start-mode-pill'),modeChoice:document.querySelector('fieldset.mode-choice:not(.compact)'),hostAssignment:$('#host-assignment'),hostConditionLabel:$('#host-condition-label'),hostPairLabel:$('#host-pair-label'),hostReadySummary:$('#host-ready-summary'),hostBeginRun:$('#host-begin-run'),hostReturnConsent:$('#host-return-consent'),demoCondition:$('#demo-condition'),stage:$('#run-stage'),title:$('#run-title'),instruction:$('#run-instruction'),timer:$('#timer'),timerLabel:$('#timer-label'),progress:$('#progress-fill'),meta:$('#run-meta'),board:$('#experiment-board'),phasePanel:$('#phase-panel'),phaseCopy:$('#phase-copy'),selected:$('#selected-readout'),phaseButton:$('#phase-primary'),advice:$('#advice-card'),adviceTitle:$('#advice-title'),adviceCopy:$('#advice-copy'),stepCount:$('#step-count'),withdraw:$('#withdraw'),withdrawConfirmation:$('#withdraw-confirmation'),withdrawContinue:$('#withdraw-continue'),withdrawConfirm:$('#withdraw-confirm'),finish:$('#finish-questionnaire'),completeTitle:$('#complete-title'),completeSummary:$('#complete-summary'),completeWarning:$('#completion-warning'),exportJson:$('#export-json'),next:$('#next-participant')};
const labels={baseline:'基础测',practice:'正式练习',posttest:'无AI后测'};
let study,advice,session,timerId,lastRenderKey=null,withdrawalSubmitting=false,hostLink=null,hostReady=false;
const esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
let toastTimer;
function toast(message){ui.toast.textContent=message;ui.toast.hidden=false;ui.toast.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>ui.toast.classList.remove('show'),2600);}
function hideAll(){ui.start.hidden=true;ui.hostReady.hidden=true;ui.run.hidden=true;ui.questionnaire.hidden=true;ui.complete.hidden=true;}
function storageAdapter(){try{return{getItem:k=>localStorage.getItem(k),setItem:(k,v)=>localStorage.setItem(k,v)};}catch(error){return{getItem:()=>{throw error;},setItem:()=>{throw error;}};}}
async function digest(bytes){const h=await crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(h)].map(x=>x.toString(16).padStart(2,'0')).join('');}
function parseHostLink(){const params=new URLSearchParams(location.search),condition=params.get('condition'),mode=params.get('mode'),rawPair=params.get('pair_id');if(mode&&mode!=='pilot_link')throw new Error('参与链接运行模式无效');if(!condition){if(mode==='pilot_link'||rawPair!==null)throw new Error('主持人链接缺少条件');return null;}if(!['AI','control'].includes(condition))throw new Error('主持人链接条件无效；请联系主持人重新分配');const pair_id=rawPair?.trim()||null;if(pair_id&&!/^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/.test(pair_id))throw new Error('主持人链接配对编号无效');return{mode:'pilot_link',condition,pair_id};}
async function loadMaterials(){
  const [infoRes,studyRes,adviceRes]=await Promise.all([fetch(new URL('./build-info.json',import.meta.url)),fetch(new URL('./study-a.json',import.meta.url)),fetch(new URL('./advice-a.json',import.meta.url))]);
  if(!infoRes.ok||!studyRes.ok||!adviceRes.ok)throw new Error('A套材料未包含在本地构建中');
  const info=await infoRes.json(),studyBytes=await studyRes.arrayBuffer(),adviceBytes=await adviceRes.arrayBuffer();
  if(info.schema_version!=='gomoku-web-manifest/v1'||info.form_a_sha256!==await digest(studyBytes)||info.form_a_advice_sha256!==await digest(adviceBytes))throw new Error('A套材料完整性核对失败');
  study=JSON.parse(new TextDecoder().decode(studyBytes));advice=JSON.parse(new TextDecoder().decode(adviceBytes));
  if(study.form_id!=='A'||study.items.length!==10||study.stage_counts.baseline!==3||study.stage_counts.practice!==4||study.stage_counts.posttest!==3||advice.form_id!=='A')throw new Error('A套题量/阶段配置不匹配');
  if(study.protocol_sha256!==info.form_a_protocol_sha256||study.protocol_version!==advice.protocol_version)throw new Error('A套协议版本/哈希不匹配');
  if(study.rules_version!=='GOMOKU-R001/v0.1'||study.material_version!=='puzzle-candidates-v3/2026-11-04-r3')throw new Error('A套规则或材料版本不匹配');
  study.study_sha256=info.form_a_sha256;study.advice_sha256=info.form_a_advice_sha256;
  for(const item of study.items){if(!['baseline','practice','posttest'].includes(item.stage)||item.task.task_side!==item.side_to_move)throw new Error(`题目配置错误：${item.id}`);}
  session=createExperimentSession({study,advice,storage:storageAdapter()});
}
function feedbackStorage(){if(!session)return;const issues=session.issues;ui.notice.hidden=!issues.length;ui.notice.textContent=issues.join(' ');}
function available(pos,item){return !item.board.pieces.some(x=>x.pos===pos);}
function addBoardGrid(){
  const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('class','exp-grid-lines');svg.setAttribute('viewBox','0 0 560 560');svg.setAttribute('aria-hidden','true');
  let d='';for(let i=0;i<15;i++){const n=21+37*i;d+=`M21 ${n}H539 M${n} 21V539`;const col=document.createElementNS(ns,'text');col.setAttribute('x',n);col.setAttribute('y','14');col.setAttribute('text-anchor','middle');col.textContent=String.fromCharCode(65+i);svg.append(col);const row=document.createElementNS(ns,'text');row.setAttribute('x','9');row.setAttribute('y',n+4);row.setAttribute('text-anchor','middle');row.textContent=String(i+1);svg.append(row);}const path=document.createElementNS(ns,'path');path.setAttribute('d',d);path.setAttribute('fill','none');path.setAttribute('stroke','#806b4788');path.setAttribute('stroke-width','1');svg.prepend(path);ui.board.append(svg);
}
function moveKeyboard(event,row,col,item){if(!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key))return;event.preventDefault();let r=row,c=col;for(let tries=0;tries<225;tries++){if(event.key==='ArrowUp')r--;if(event.key==='ArrowDown')r++;if(event.key==='ArrowLeft')c--;if(event.key==='ArrowRight')c++;if(r<0||r>14||c<0||c>14)return;const pos=String.fromCharCode(65+c)+(r+1);if(!available(pos,item))continue;ui.board.querySelector(`[data-pos="${pos}"]`)?.focus();return;}}
function renderBoard(item,selected,active){ui.board.replaceChildren();ui.board.setAttribute('aria-label',`${item.id}，15乘15棋盘，左上A1`);addBoardGrid();
  const run=session.view().active_run;
  for(let row=0;row<15;row++)for(let col=0;col<15;col++){
    const pos=String.fromCharCode(65+col)+(row+1),stone=item.board.pieces.find(x=>x.pos===pos),button=document.createElement('button');button.type='button';button.className='exp-point';button.style.left=`${((21+37*col)/560)*100}%`;button.style.top=`${((21+37*row)/560)*100}%`;button.dataset.pos=pos;
    button.setAttribute('aria-label',`${pos} ${stone?(stone.color==='B'?'黑棋':'白棋'):'空点'}`);
    if(stone){button.disabled=true;const dot=document.createElement('span');dot.className=`stone ${stone.color==='B'?'black':'white'}`;button.append(dot);}
    else{button.disabled=!active;if(selected===pos)button.classList.add('selected');button.addEventListener('click',()=>{try{session.selectMove(pos);render();}catch(error){toast(error.message);}});button.addEventListener('keydown',e=>moveKeyboard(e,row,col,item));}
    ui.board.append(button);
  }
}
function score(item,pos){return evaluate_move({rules_version:study.rules_version,board:item.board,side_to_move:item.side_to_move,task:item.task,move:{pos,color:item.side_to_move}});}
function formatTime(ms){const seconds=Math.max(0,Math.ceil(ms/1000));return`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;}
function renderScale(containerId,name){const container=$(containerId);container.replaceChildren();for(let n=1;n<=5;n++){const label=document.createElement('label'),input=document.createElement('input'),span=document.createElement('span');input.type='radio';input.name=name;input.value=String(n);span.textContent=String(n);label.append(input,span);container.append(label);}}
function questionnaireValues(){const val=name=>{const v=document.querySelector(`input[name="${name}"]:checked`)?.value;return v?Number(v):null;};return{gomoku_experience:$('#gomoku-experience').value.trim()||null,perceived_difficulty:val('difficulty'),review_helpfulness:val('help'),ai_trust:val('trust'),comment:$('#comment').value.trim()||null};}
function restoreQuestionnaire(draft={}){$('#gomoku-experience').value=draft.gomoku_experience??'';$('#comment').value=draft.comment??'';for(const[name,key]of [['difficulty','perceived_difficulty'],['help','review_helpfulness'],['trust','ai_trust']])for(const input of document.querySelectorAll(`input[name="${name}"]`))input.checked=String(draft[key]??'')===input.value;}
function clearQuestionnaire(){restoreQuestionnaire({});}
function saveQuestionnaireDraft(){try{session.updateQuestionnaireDraft(questionnaireValues());}catch(error){toast(error.message);}}
function openWithdrawConfirmation(){if(withdrawalSubmitting)return;ui.withdrawConfirmation.hidden=false;ui.withdraw.setAttribute('aria-expanded','true');ui.withdrawContinue.focus();}
function closeWithdrawConfirmation(returnFocus=true){ui.withdrawConfirmation.hidden=true;ui.withdraw.setAttribute('aria-expanded','false');if(returnFocus)ui.withdraw.focus();}
function confirmWithdrawal(){if(withdrawalSubmitting||ui.withdrawConfirmation.hidden)return;withdrawalSubmitting=true;ui.withdrawConfirm.disabled=true;try{session.withdraw();render();ui.exportJson.focus();}catch(error){withdrawalSubmitting=false;ui.withdrawConfirm.disabled=false;toast(error.message);}}
function render(){
  if(!session)return;feedbackStorage();const v=session.viewWithTimer(),run=v.active_run;hideAll();
  lastRenderKey=run?`${run.run_id}|${run.status}|${run.current_index}|${run.phase}`:null;
  if(!run){
    if(hostLink){ui.modeChoice.hidden=true;ui.demoCondition.hidden=true;ui.hostAssignment.hidden=false;ui.startModePill.textContent='主持人分配';ui.hostConditionLabel.textContent=`主持人分配：${hostLink.condition==='AI'?'AI建议':'自行复查'}`;ui.hostPairLabel.textContent=hostLink.pair_id?`配对编号：${hostLink.pair_id}`:'未提供配对编号';ui.hostReady.hidden=!hostReady;ui.start.hidden=hostReady;ui.hostReadySummary.textContent=`条件：${hostLink.condition==='AI'?'AI建议':'自行复查'} · ${hostLink.pair_id?`配对编号 ${hostLink.pair_id}`:'无配对编号'}`;ui.startButton.textContent='同意并进入等待开始';ui.startButton.disabled=!ui.consent.checked;return;}
    ui.start.hidden=false;ui.modeChoice.hidden=false;ui.hostAssignment.hidden=true;ui.demoCondition.hidden=ui.mode()!=='demo';ui.startModePill.textContent='本机试跑';ui.startButton.textContent='开始基础测 →';ui.startButton.disabled=!ui.consent.checked;return;
  }
  if(run.status==='in_progress'){
    ui.run.hidden=false;const index=run.current_index,rec=run.items[index],item=study.items[index];if(!rec||!item){ui.fatal.hidden=false;ui.fatalMessage.textContent='运行状态不完整，请导出记录并联系工作人员。';ui.run.hidden=true;return;}
    ui.stage.textContent=labels[item.stage];ui.title.textContent=`第${index+1}题 · 你执${item.side_to_move==='B'?'黑':'白'}`;
    const phase=run.phase,practice=item.stage==='practice';
    ui.instruction.textContent=`你执${item.side_to_move==='B'?'黑':'白'}方。本题目标：${item.prompt_zh}`;
    ui.meta.textContent=`${run.participant_id} · ${run.mode==='demo'?'演示':run.allocation_kind==='host_link'?'主持人分配试跑':'本机试跑'} · ${run.condition==='AI'?'AI条件':'对照条件'} · 仅记录选择，不在本页显示正误`;
    const remaining=phase==='initial'&&v.initial_remaining_ms!==null?v.initial_remaining_ms:v.time_remaining_ms??0;
    ui.timerLabel.textContent=phase==='initial'?'初选剩余':phase==='review'?'本题剩余':'剩余时间';ui.timer.textContent=formatTime(remaining);
    ui.progress.style.width=`${Math.round(index/10*100)}%`;ui.stepCount.textContent=`${index+1} / 10`;
    const selected=rec.selected_move??(phase==='review'?rec.initial_move:null);ui.selected.querySelector('strong').textContent=selected??'—';renderBoard(item,selected,true);
    if(practice&&phase==='initial'){
      ui.phasePanel.hidden=false;ui.advice.hidden=true;ui.phaseCopy.textContent='请先独立选择一个落点。确认后初选将锁定，随后进入复查阶段。';ui.phaseButton.textContent='锁定初选';ui.phaseButton.disabled=!selected;ui.phaseButton.onclick=()=>{try{session.confirmInitial(score);render();}catch(error){toast(error.message);}};
    }else if(practice&&phase==='review'){
      ui.phasePanel.hidden=false;ui.advice.hidden=false;ui.phaseCopy.textContent=`初选已锁定：${rec.initial_move}。可保留，也可在棋盘选一个最终落点后提交。`;
      if(run.condition==='AI'){const suggestion=v.advice;if(!suggestion){ui.adviceTitle.textContent='建议不可用';ui.adviceCopy.textContent='本题建议材料缺失，已暂停该运行。';ui.phaseButton.disabled=true;}else{ui.adviceTitle.textContent=`建议落点：${suggestion.move}`;ui.adviceCopy.textContent=suggestion.reason_zh;ui.phaseButton.disabled=false;}}
      else{ui.adviceTitle.textContent='自行复查';ui.adviceCopy.textContent='请重新检查棋盘，可保留初选或修改为你认为正确的落点。';ui.phaseButton.disabled=false;}
      ui.phaseButton.textContent='提交最终选择';ui.phaseButton.onclick=()=>{try{session.submitFinal(score);render();}catch(error){toast(error.message);}};
    }else{
      ui.phasePanel.hidden=false;ui.advice.hidden=true;ui.phaseCopy.textContent='请独立选择一个落点并确认。本阶段不显示建议或正误反馈。';ui.phaseButton.textContent='确认并继续';ui.phaseButton.disabled=!selected;ui.phaseButton.onclick=()=>{try{session.submitFinal(score);render();}catch(error){toast(error.message);}};
    }
    return;
  }
  if(run.status==='questionnaire'){
    ui.questionnaire.hidden=false;$('#trust-question').hidden=run.condition!=='AI';restoreQuestionnaire(run.questionnaire_draft??{});return;
  }
  if(['complete','withdrawn'].includes(run.status)){
    ui.complete.hidden=false;ui.completeTitle.textContent=run.status==='withdrawn'?'已退出本次':'A套已结束';ui.completeSummary.textContent=`匿名编号 ${run.participant_id} · ${run.condition==='AI'?'AI条件':'对照条件'} · ${run.mode==='demo'?'演示记录':'本机试跑记录'} · 包含10条题目结果/未完成状态`;
    ui.completeWarning.hidden=session.persisted;ui.completeWarning.textContent=session.persisted?'':'本机保存失败；请先导出并联系工作人员。';return;
  }
}
function timerTick(){
  if(!session)return;const v=session.viewWithTimer(),run=v.active_run;
  const key=run?`${run.run_id}|${run.status}|${run.current_index}|${run.phase}`:null;
  if(key!==lastRenderKey){render();return;}
  if(run?.status==='in_progress'){
    const ms=run.phase==='initial'&&v.initial_remaining_ms!==null?v.initial_remaining_ms:v.time_remaining_ms??0;
    ui.timerLabel.textContent=run.phase==='initial'?'初选剩余':run.phase==='review'?'本题剩余':'剩余时间';ui.timer.textContent=formatTime(ms);ui.progress.style.width=`${Math.round(run.current_index/10*100)}%`;
  }
}
function download(name,type,contents){const a=document.createElement('a'),url=URL.createObjectURL(new Blob([contents],{type}));a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1500);}
async function init(){
  try{hostLink=parseHostLink();await loadMaterials();renderScale('#difficulty-scale','difficulty');renderScale('#help-scale','help');renderScale('#trust-scale','trust');render();ui.consent.addEventListener('change',render);for(const r of document.querySelectorAll('input[name="mode"]'))r.addEventListener('change',render);
    ui.startButton.addEventListener('click',()=>{try{if(hostLink){if(!ui.consent.checked)throw new Error('需要先确认知情同意');hostReady=true;render();ui.hostBeginRun.focus();return;}session.beginRun({mode:ui.mode(),manual_condition:ui.condition(),consent:ui.consent.checked});render();}catch(error){toast(error.message);}});
    ui.hostReturnConsent.addEventListener('click',()=>{hostReady=false;render();ui.consent.focus();});
    ui.hostBeginRun.addEventListener('click',()=>{try{if(!hostLink||!hostReady)throw new Error('主持人链接状态无效');session.beginRun({mode:'pilot',manual_condition:hostLink.condition,allocation_kind:'host_link',pair_id:hostLink.pair_id,consent:true});hostReady=false;render();}catch(error){toast(error.message);}});
    ui.withdraw.addEventListener('click',openWithdrawConfirmation);
    ui.withdrawContinue.addEventListener('click',()=>closeWithdrawConfirmation());
    ui.withdrawConfirm.addEventListener('click',confirmWithdrawal);
    for(const field of document.querySelectorAll('#gomoku-experience,#comment,.questionnaire-card input[type="radio"]'))field.addEventListener('input',saveQuestionnaireDraft);
    for(const field of document.querySelectorAll('.questionnaire-card input[type="radio"]'))field.addEventListener('change',saveQuestionnaireDraft);
    ui.finish.addEventListener('click',()=>{try{session.setQuestionnaire(questionnaireValues());render();}catch(error){toast(error.message);}});
    ui.next.addEventListener('click',()=>{try{session.nextParticipant();withdrawalSubmitting=false;ui.withdrawConfirm.disabled=false;closeWithdrawConfirmation(false);ui.consent.checked=false;document.querySelector('input[name="mode"][value="demo"]').checked=true;document.querySelector('input[name="condition"][value="AI"]').checked=true;clearQuestionnaire();render();ui.consent.focus();}catch(error){toast(error.message);}});
    $('#export-json').addEventListener('click',()=>download('gomoku-study-A.json','application/json;charset=utf-8',JSON.stringify(session.exportData(),null,2)));
    $('#export-csv').addEventListener('click',()=>download('gomoku-study-A.csv','text/csv;charset=utf-8','\ufeff'+session.exportCsv()));
    document.addEventListener('visibilitychange',()=>session.visibilityChanged(document.hidden));
    timerId=setInterval(timerTick,250);
  }catch(error){hideAll();ui.fatal.hidden=false;ui.fatalMessage.textContent=error.message;}
}
init();
