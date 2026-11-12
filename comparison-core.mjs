import { evaluate_move } from './engine/engine.mjs';

export const FORM_A_ORDER=['DEF-A04','DEF-B06','DEF-C01','ATT-PHOTO-02','DEF-C03','DEF-D01','DEF-D03','DEF-D05','DEF-E04','DEF-D09'];
const requiredMeta=['participant_id','run_id','form_id','condition','mode','run_status','protocol_version','protocol_sha256','material_version','rules_version','study_sha256','advice_sha256','advice_version'];
const nullableFields=['pair_id','initial_move','final_move','timeout_phase','started_at','submitted_at','initial_submitted_at','initial_deadline_at','advice_shown_at'];
const boolFields=['initial_correct','final_correct','timeout','timing_valid'];
const timeFields=['initial_ms','review_ms','total_ms','processing_delay_ms'];

export function parseCsvText(text){
  const source=String(text).replace(/^\uFEFF/,''),rows=[];let row=[],field='',quoted=false,atFieldStart=true;
  for(let i=0;i<source.length;i++){
    const c=source[i];
    if(quoted){if(c==='"'&&source[i+1]==='"'){field+='"';i++;}else if(c==='"')quoted=false;else field+=c;continue;}
    if(c==='"'){if(!atFieldStart)throw new Error('CSV含有格式错误的引号');quoted=true;atFieldStart=false;continue;}
    if(c===','){row.push(field);field='';atFieldStart=true;continue;}
    if(c==='\n'){row.push(field.replace(/\r$/,''));rows.push(row);row=[];field='';atFieldStart=true;continue;}
    field+=c;atFieldStart=false;
  }
  if(quoted)throw new Error('CSV引号未闭合');
  if(field.length||row.length){row.push(field.replace(/\r$/,''));rows.push(row);}
  const [headers,...body]=rows;if(!headers?.length)throw new Error('CSV缺少表头');
  if(new Set(headers).size!==headers.length||headers.some(x=>!x))throw new Error('CSV表头重复或为空');
  return body.filter(cells=>cells.some(v=>v!=='')).map(cells=>{if(cells.length!==headers.length)throw new Error('CSV列数不一致');return Object.fromEntries(headers.map((h,i)=>[h,cells[i]]));});
}
function parseNullable(value){return value===''||value===undefined?null:value;}
function parseBool(value){if(value===true||value==='true')return true;if(value===false||value==='false')return false;if(value===''||value===undefined||value===null)return null;throw new Error(`布尔字段格式错误：${value}`);}
function parseTime(value){if(value===''||value===undefined||value===null)return null;const n=Number(value);if(!Number.isFinite(n)||n<0)throw new Error(`用时字段格式错误：${value}`);return n;}
function parseJsonField(value,name){if(Array.isArray(value))return value;if(value===''||value===undefined||value===null)return[];try{const parsed=JSON.parse(value);if(!Array.isArray(parsed))throw new Error();return parsed;}catch{throw new Error(`CSV的${name}字段不是有效事件数组`);}}
function normalizeItem(row){
  const item={...row,order:Number(row.order)};
  for(const field of nullableFields)item[field]=parseNullable(item[field]);
  for(const field of boolFields)item[field]=parseBool(item[field]);
  for(const field of timeFields)item[field]=parseTime(item[field]);
  if(!Number.isInteger(item.order)||item.order<1||item.order>10)throw new Error('题目序号格式无效');
  return item;
}
function metaFromCsv(row){
  const meta={};for(const key of requiredMeta)meta[key]=parseNullable(row[key]);
  for(const key of ['allocation_id','allocation_kind','allocation_seed','allocation_block_id','allocation_order','allocation_slot','pair_id'])meta[key]=parseNullable(row[key]);
  if(Object.hasOwn(row,'consent_accepted'))meta.consent_accepted=parseBool(row.consent_accepted);
  if(meta.run_status==null)throw new Error('CSV缺少run_status');
  return meta;
}
function runsFromCsv(text){
  const rows=parseCsvText(text);if(!rows.length)throw new Error('CSV没有题目记录');
  for(const key of [...requiredMeta,'order','stage','item_id','side','task_type','status','item_events','run_events'])if(!Object.hasOwn(rows[0],key))throw new Error(`CSV缺少字段：${key}`);
  const groups=new Map();
  for(const source of rows){
    const meta=metaFromCsv(source);if(!meta.run_id)throw new Error('CSV缺少run_id');
    let group=groups.get(meta.run_id);
    if(!group){group={...meta,events:parseJsonField(source.run_events,'run_events'),items:[]};groups.set(meta.run_id,group);}
    else for(const key of requiredMeta)if(group[key]!==meta[key])throw new Error(`run ${meta.run_id} 的重复元数据不一致：${key}`);
    group.items.push({...normalizeItem(source),item_events:parseJsonField(source.item_events,'item_events')});
  }
  return [...groups.values()];
}
export function parseExportText(filename,text){
  if(/\.csv$/i.test(filename))return runsFromCsv(text);
  let data;try{data=JSON.parse(String(text).replace(/^\uFEFF/,''));}catch{throw new Error('JSON文件无法解析');}
  if(data?.schema_version!=='gomoku-study-export/v1'||data.form_id!=='A')throw new Error('文件不是A套原始参与者导出JSON');
  let runs=Array.isArray(data.runs)?data.runs.filter(Boolean):[];
  if(!runs.length&&Array.isArray(data.items)&&data.items.length){const groups=new Map();for(const row of data.items){if(!groups.has(row.run_id))groups.set(row.run_id,{...row,items:[]});groups.get(row.run_id).items.push(row);}runs=[...groups.values()];}
  if(!runs.length)throw new Error('导出JSON中没有可选运行');
  const ids=new Set();for(const run of runs){if(!run.run_id)throw new Error('运行缺少run_id');if(ids.has(run.run_id))throw new Error(`重复run_id：${run.run_id}`);ids.add(run.run_id);}
  return runs;
}

export function scoreRun(run,{study,manifest,advice}){
  for(const key of requiredMeta){const value=key==='run_status'?(run.run_status??run.status):run[key];if(value==null)throw new Error(`运行 ${run.run_id??'?'} 缺少${key}`);}
  if(run.form_id!=='A'||run.protocol_sha256!==manifest.form_a_protocol_sha256||run.protocol_version!==study.protocol_version||run.material_version!==study.material_version||run.rules_version!==study.rules_version||run.study_sha256!==manifest.form_a_sha256||run.advice_sha256!==manifest.form_a_advice_sha256||run.advice_version!==advice.advice_version)throw new Error(`运行 ${run.run_id} 的材料/规则版本不匹配`);
  if(!['AI','control'].includes(run.condition)||!['demo','pilot'].includes(run.mode))throw new Error(`运行 ${run.run_id} 的条件或模式无效`);
  if(run.mode==='pilot'&&(run.allocation_kind!=='host_link'||(run.pair_id!=null&&!/^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/.test(run.pair_id))))throw new Error(`试跑 ${run.run_id} 不是有效主持人配对链接记录`);
  if(run.items?.length!==10)throw new Error(`运行 ${run.run_id} 必须有10条A套题目记录`);
  const itemReports=[],counts={baseline:0,initial:0,final:0,posttest:0,timeouts:0,not_reached:0,technical:0,incomplete:0};
  for(let index=0;index<10;index++){
    const row=normalizeItem(run.items[index]),item=study.items[index];
    if(row.order!==index+1||row.item_id!==FORM_A_ORDER[index]||item.id!==FORM_A_ORDER[index]||row.stage!==item.stage||row.side!==item.side_to_move||row.task_type!==item.task.type)throw new Error(`运行 ${run.run_id} 的A套题序/元数据不符：第${index+1}题`);
    if(row.status==='not_reached'){
      if(row.initial_move!==null||row.final_move!==null||row.final_correct!==null)throw new Error(`未到达题目包含作答：${row.item_id}`);
      counts.not_reached++;itemReports.push({order:row.order,item_id:row.item_id,stage:row.stage,status:row.status,initial_move:null,initial_correct:null,final_move:null,final_correct:null,timeout:false,timing_valid:null,total_ms:null,processing_delay_ms:row.processing_delay_ms});continue;
    }
    if(!['in_progress','submitted','timeout','technical_failure'].includes(row.status))throw new Error(`未知题目状态：${row.status}`);
    if(row.timeout)counts.timeouts++;
    if(row.status==='technical_failure')counts.technical++;
    if(row.status==='in_progress')counts.incomplete++;
    let initialCorrect=null,finalCorrect=null;
    if(row.initial_move!==null){
      if(item.stage!=='practice')throw new Error(`非练习题含初选：${row.item_id}`);
      const r=evaluate_move({rules_version:study.rules_version,board:item.board,side_to_move:item.side_to_move,task:item.task,move:{pos:row.initial_move,color:item.side_to_move}});
      if(r.valid_position!==true||!r.answer)throw new Error(`初选落点非法：${row.item_id}`);
      initialCorrect=r.answer.correct;if(row.initial_correct!==initialCorrect)throw new Error(`初选存储分数与重评分不符：${row.item_id}`);counts.initial++;
    }else if(row.initial_correct!==null)throw new Error(`缺少初选却保存分数：${row.item_id}`);
    if(row.final_move!==null){
      if(row.status!=='submitted')throw new Error(`未提交题目含最终选择：${row.item_id}`);
      const r=evaluate_move({rules_version:study.rules_version,board:item.board,side_to_move:item.side_to_move,task:item.task,move:{pos:row.final_move,color:item.side_to_move}});
      if(r.valid_position!==true||!r.answer)throw new Error(`最终落点非法：${row.item_id}`);
      finalCorrect=r.answer.correct;if(row.final_correct!==finalCorrect)throw new Error(`最终存储分数与重评分不符：${row.item_id}`);
      if(finalCorrect){if(item.stage==='baseline')counts.baseline++;if(item.stage==='practice')counts.final++;if(item.stage==='posttest')counts.posttest++;}
    }else if(row.final_correct!==null)throw new Error(`缺少最终选择却保存分数：${row.item_id}`);
    if(row.status==='submitted'&&row.final_move===null)throw new Error(`已提交题目缺少最终选择：${row.item_id}`);
    if(item.stage==='practice'&&row.status==='submitted'&&row.initial_move===null)throw new Error(`练习题已提交却缺少初选：${row.item_id}`);
    if(item.stage!=='practice'&&(row.initial_move!==null||row.initial_correct!==null))throw new Error(`非练习题含初选字段：${row.item_id}`);
    if(row.timing_valid===false&&(row.total_ms!==null||row.initial_ms!==null||row.review_ms!==null))throw new Error(`时钟无效题目不可携带有效时长：${row.item_id}`);
    itemReports.push({order:row.order,item_id:row.item_id,stage:row.stage,status:row.status,initial_move:row.initial_move,initial_correct:initialCorrect,final_move:row.final_move,final_correct:finalCorrect,timeout:Boolean(row.timeout),timeout_phase:row.timeout_phase,timing_valid:row.timing_valid,total_ms:row.total_ms,processing_delay_ms:row.processing_delay_ms});
  }
  const practice=run.items.slice(3,7).map(normalizeItem);
  const practiceTimeValid=practice.every(row=>['submitted','timeout'].includes(row.status)&&row.timing_valid===true&&row.total_ms!==null);
  const practiceTimeMs=practiceTimeValid?practice.reduce((sum,row)=>sum+row.total_ms,0):null;
  const initialCorrect=practice.filter(row=>row.initial_move!==null&&row.initial_correct===true).length;
  const finalCorrect=counts.final;
  const warnings=[];
  const consentAccepted=run.consent?.accepted??run.consent_accepted??null;
  if(run.mode==='pilot'&&consentAccepted!==true)throw new Error(`pilot运行缺少同意记录：${run.run_id}`);
  if(consentAccepted!==true)warnings.push('导出中缺少有效同意标记');
  if(run.mode==='demo')warnings.push('演示数据，仅供功能测试，不属于正式试跑');
  const runStatus=run.run_status??run.status??'unknown';if(runStatus!=='complete')warnings.push(`运行未完整结束：${runStatus}`);
  if(counts.timeouts)warnings.push(`包含${counts.timeouts}道超时题`);
  if(counts.not_reached)warnings.push(`包含${counts.not_reached}道未到达题`);
  if(counts.incomplete)warnings.push(`包含${counts.incomplete}道未提交题`);
  if(!practiceTimeValid)warnings.push('练习总用时无效或不完整，未按0秒计');
  if(itemReports.some(row=>row.timing_valid===false))warnings.push('存在时钟无效题目');
  return{participant_id:run.participant_id,run_id:run.run_id,form_id:'A',condition:run.condition,mode:run.mode,allocation_kind:run.allocation_kind??null,pair_id:run.pair_id??null,status:runStatus,baseline_correct:counts.baseline,baseline_denominator:3,practice_initial_correct:initialCorrect,practice_initial_denominator:4,practice_final_correct:finalCorrect,practice_final_denominator:4,net_correction:finalCorrect-initialCorrect,net_correction_rate:(finalCorrect-initialCorrect)/4,practice_total_ms:practiceTimeMs,practice_time_valid:practiceTimeValid,posttest_correct:counts.posttest,posttest_denominator:3,timeouts:counts.timeouts,not_reached:counts.not_reached,incomplete:counts.incomplete,technical_failures:counts.technical,items:itemReports,warnings};
}

export function compareRuns(leftRun,rightRun,context){
  if(leftRun.run_id===rightRun.run_id)throw new Error('不能把同一运行与自身比较');
  if(leftRun.mode!==rightRun.mode)throw new Error('不能混合比较demo与pilot运行');
  const left=scoreRun(leftRun,context),right=scoreRun(rightRun,context),warnings=[...left.warnings,...right.warnings];
  if(left.mode==='pilot'){
    if(left.allocation_kind!=='host_link'||right.allocation_kind!=='host_link')throw new Error('pilot比较只接受主持人链接分组');
    if(!left.pair_id||!right.pair_id)throw new Error('pilot主持人链接缺少pair_id');
    if(left.pair_id!==right.pair_id)throw new Error('两份pilot结果的pair_id不一致');
  }else if(!left.pair_id||!right.pair_id)warnings.push('旧demo没有完整pair_id；以下仅为描述性并列，不代表配对试跑');
  else if(left.pair_id!==right.pair_id)warnings.push('两份demo的pair_id不同；不能视作同一配对');
  if(left.condition===right.condition)warnings.push('两份记录的条件相同，未形成AI/control对照');
  const rows=left.items.map((item,i)=>({item_id:item.item_id,stage:item.stage,left:{status:item.status,initial_move:item.initial_move,initial_correct:item.initial_correct,final_move:item.final_move,final_correct:item.final_correct,timeout:item.timeout,timing_valid:item.timing_valid,total_ms:item.total_ms},right:{status:right.items[i].status,initial_move:right.items[i].initial_move,initial_correct:right.items[i].initial_correct,final_move:right.items[i].final_move,final_correct:right.items[i].final_correct,timeout:right.items[i].timeout,timing_valid:right.items[i].timing_valid,total_ms:right.items[i].total_ms}}));
  return{schema_version:'gomoku-study-comparison/v1',form_id:'A',mode:left.mode,pair_id:left.pair_id&&left.pair_id===right.pair_id?left.pair_id:null,warnings,participants:[left,right],items:rows};
}

function csvCell(value){let text=value==null?'':Array.isArray(value)||typeof value==='object'?JSON.stringify(value):String(value);if(/^[\s]*[=+\-@]/.test(text)||/^[\t\r]/.test(text))text="'"+text;return`"${text.replaceAll('"','""')}"`;}
export function comparisonToCsv(result,language='zh-CN'){
  const keys=['pair_id','mode','participant_id','condition','run_id','run_status','item_id','stage','item_status','initial_move','initial_correct','final_move','final_correct','timeout','timing_valid','total_ms','baseline_correct','baseline_denominator','practice_initial_correct','practice_initial_denominator','practice_final_correct','practice_final_denominator','net_correction','net_correction_rate','practice_total_ms','practice_time_valid','posttest_correct','posttest_denominator','not_reached','incomplete','technical_failures'];
  const chineseHeaders=['配对编号','模式','匿名编号','条件','运行编号','运行状态','题目编号','阶段','题目状态','初选落点','初选正确','终选落点','终选正确','超时','时钟有效','用时毫秒','基础测正确','基础测分母','练习初选正确','练习初选分母','练习终选正确','练习终选分母','净纠错','净纠错率','练习总用时毫秒','练习用时有效','后测正确','后测分母','未到达','未完成','技术故障'];
  const englishHeaders=['Pair ID','Mode','Participant ID','Condition','Run ID','Run status','Item ID','Stage','Item status','Initial move','Initial correct','Final move','Final correct','Timeout','Timing valid','Duration (ms)','Baseline correct','Baseline denominator','Practice initial correct','Practice initial denominator','Practice final correct','Practice final denominator','Net correction','Net correction rate','Practice total (ms)','Practice time valid','Post-test correct','Post-test denominator','Not reached','Incomplete','Technical failures'];
  const headers=language==='en'?englishHeaders:chineseHeaders;
  const rows=[];
  for(const report of result.participants){
    const summary={pair_id:report.pair_id,mode:report.mode,participant_id:report.participant_id,condition:report.condition,run_id:report.run_id,run_status:report.status,baseline_correct:report.baseline_correct,baseline_denominator:report.baseline_denominator,practice_initial_correct:report.practice_initial_correct,practice_initial_denominator:report.practice_initial_denominator,practice_final_correct:report.practice_final_correct,practice_final_denominator:report.practice_final_denominator,net_correction:report.net_correction,net_correction_rate:report.net_correction_rate,practice_total_ms:report.practice_total_ms,practice_time_valid:report.practice_time_valid,posttest_correct:report.posttest_correct,posttest_denominator:report.posttest_denominator,not_reached:report.not_reached,incomplete:report.incomplete,technical_failures:report.technical_failures};
    for(const item of report.items){const row={...summary,item_id:item.item_id,stage:item.stage,item_status:item.status,initial_move:item.initial_move,initial_correct:item.initial_correct,final_move:item.final_move,final_correct:item.final_correct,timeout:item.timeout,timing_valid:item.timing_valid,total_ms:item.total_ms};rows.push(keys.map(key=>csvCell(row[key])).join(','));}
  }
  return[headers.map(csvCell).join(','),...rows].join('\r\n')+'\r\n';
}
