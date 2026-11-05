import { comparisonToCsv, compareRuns, parseExportText } from './comparison-core.mjs';

const $=selector=>document.querySelector(selector);
const sides={left:{file:$('#file-left'),select:$('#run-left'),status:$('#file-left-status')},right:{file:$('#file-right'),select:$('#run-right'),status:$('#file-right-status')}};
const context={study:null,advice:null,manifest:null};
let loaded={left:null,right:null},comparison=null;
const esc=value=>String(value??'');

function showError(message){const box=$('#compare-error');box.textContent=message;box.hidden=!message;}
function addNotice(container,message,kind='compare-warning'){const p=document.createElement('p');p.className=kind;p.textContent=message;container.append(p);}
function selectedRun(side){const data=loaded[side],id=sides[side].select.value;return data?.runs.find(run=>run.run_id===id)??null;}
function updateCompareButton(){ $('#compare-runs').disabled=!(selectedRun('left')&&selectedRun('right')); }
function updateRunSelector(side){
  const target=sides[side].select,data=loaded[side];target.replaceChildren();
  const first=document.createElement('option');first.value='';first.textContent=data?.runs.length>1?'请选择一个运行':'选择运行';target.append(first);
  if(data)for(const run of data.runs){const option=document.createElement('option');option.value=run.run_id;option.textContent=`${run.participant_id??'匿名编号'} · ${run.condition??'无条件'} · ${run.mode??'未知模式'} · ${run.status??run.run_status??'未知状态'} · ${run.run_id.slice(0,8)}`;target.append(option);}
  target.disabled=!data;if(data?.runs.length===1)target.value=data.runs[0].run_id;updateCompareButton();
}
async function readFile(side,file){
  showError('');$('#compare-results').hidden=true;comparison=null;loaded[side]=null;
  if(!file){sides[side].status.textContent='';updateRunSelector(side);return;}
  try{const text=await file.text(),runs=parseExportText(file.name,text);loaded[side]={name:file.name,runs};sides[side].status.textContent=`已在本机读取 ${runs.length} 个运行；未上传。`;updateRunSelector(side);}
  catch(error){sides[side].status.textContent='';sides[side].select.replaceChildren(new Option('导入失败',''));sides[side].select.disabled=true;updateCompareButton();showError(error.message);}
}
function metric(label,value){const name=document.createElement('span'),data=document.createElement('strong');name.textContent=label;data.textContent=esc(value);return[name,data];}
function formatMs(value,valid){if(!valid||value===null||value===undefined)return'无效/缺失';return`${(value/1000).toFixed(1)} 秒`;}
function renderReport(report){
  const card=document.createElement('article');card.className='compare-summary-card';const title=document.createElement('h3');title.textContent=`${report.participant_id} · ${report.condition==='AI'?'AI':'对照'} · ${report.mode==='demo'?'演示':'pilot'}`;card.append(title);
  const grid=document.createElement('div');grid.className='compare-metrics';
  const pairs=[['运行状态',report.status],['配对编号',report.pair_id??'缺失'],['基础测正确',`${report.baseline_correct}/3`],['练习初选正确',`${report.practice_initial_correct}/4`],['练习终选正确',`${report.practice_final_correct}/4`],['净纠错',`${report.net_correction}/4（${(report.net_correction_rate*100).toFixed(0)}%）`],['练习总有效用时',formatMs(report.practice_total_ms,report.practice_time_valid)],['后测正确',`${report.posttest_correct}/3`],['超时 / 未到达 / 未完成',`${report.timeouts} / ${report.not_reached} / ${report.incomplete}`],['技术故障',report.technical_failures]];
  for(const [label,value] of pairs)grid.append(...metric(label,value));card.append(grid);return card;
}
function renderTable(result){
  const columns=['题目','阶段','一·初选','一·初选分','一·终选','一·终选分','二·初选','二·初选分','二·终选','二·终选分','状态 / 超时','用时'];
  const head=$('#compare-table-head');head.replaceChildren();const row=document.createElement('tr');for(const label of columns){const cell=document.createElement('th');cell.textContent=label;row.append(cell);}head.append(row);
  const body=$('#compare-table-body');body.replaceChildren();
  for(const item of result.items){const cells=[item.item_id,item.stage==='baseline'?'基础测':item.stage==='practice'?'练习':'后测',item.left.initial_move??'—',item.left.initial_correct===null?'—':item.left.initial_correct?'对':'错',item.left.final_move??'—',item.left.final_correct===null?'—':item.left.final_correct?'对':'错',item.right.initial_move??'—',item.right.initial_correct===null?'—':item.right.initial_correct?'对':'错',item.right.final_move??'—',item.right.final_correct===null?'—':item.right.final_correct?'对':'错',`${item.left.status}${item.left.timeout?' / 超时':''} · ${item.right.status}${item.right.timeout?' / 超时':''}`,`${formatMs(item.left.total_ms,item.left.timing_valid)} · ${formatMs(item.right.total_ms,item.right.timing_valid)}`];const tr=document.createElement('tr');for(const value of cells){const td=document.createElement('td');td.textContent=esc(value);tr.append(td);}body.append(tr);}
}
function download(name,type,content){const url=URL.createObjectURL(new Blob([content],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1200);}
function compare(){
  showError('');$('#compare-warnings').replaceChildren();$('#compare-result-warnings').replaceChildren();
  try{
    comparison=compareRuns(selectedRun('left'),selectedRun('right'),context);$('#compare-pair-badge').textContent=comparison.pair_id?`配对 ${comparison.pair_id}`:'未配对';
    const summary=$('#compare-summary');summary.replaceChildren(...comparison.participants.map(renderReport));
    for(const warning of comparison.warnings)addNotice($('#compare-result-warnings'),warning);
    renderTable(comparison);$('#compare-results').hidden=false;
  }catch(error){comparison=null;$('#compare-results').hidden=true;showError(error.message);}
}
async function init(){
  try{
    const [infoRes,studyRes,adviceRes]=await Promise.all([fetch(new URL('./build-info.json',import.meta.url)),fetch(new URL('./study-a.json',import.meta.url)),fetch(new URL('./advice-a.json',import.meta.url))]);
    if(!infoRes.ok||!studyRes.ok||!adviceRes.ok)throw new Error('比较材料无法载入');
    context.manifest=await infoRes.json();const studyBytes=await studyRes.arrayBuffer(),adviceBytes=await adviceRes.arrayBuffer();
    const hash=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
    if(await hash(studyBytes)!==context.manifest.form_a_sha256||await hash(adviceBytes)!==context.manifest.form_a_advice_sha256)throw new Error('比较材料完整性核对失败');
    context.study=JSON.parse(new TextDecoder().decode(studyBytes));context.advice=JSON.parse(new TextDecoder().decode(adviceBytes));
    for(const side of ['left','right']){sides[side].file.addEventListener('change',()=>readFile(side,sides[side].file.files?.[0]??null));sides[side].select.addEventListener('change',updateCompareButton);}
    $('#compare-runs').addEventListener('click',compare);
    $('#export-comparison-json').addEventListener('click',()=>{if(comparison)download('gomoku-A-comparison.json','application/json;charset=utf-8',JSON.stringify(comparison,null,2));});
    $('#export-comparison-csv').addEventListener('click',()=>{if(comparison)download('gomoku-A-comparison.csv','text/csv;charset=utf-8','\ufeff'+comparisonToCsv(comparison));});
  }catch(error){showError(error.message);}
}
init();
