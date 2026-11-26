import { formForPair, isPairId } from './forms.mjs';

const $=selector=>document.querySelector(selector);
const pairInput=$('#pair-id');
const status={AI:$('#ai-copy-status'),control:$('#control-copy-status')};
const links={AI:$('#ai-link'),control:$('#control-link')};
const qrContainers={AI:$('#ai-qr'),control:$('#control-qr')};
let language=new URLSearchParams(location.search).get('lang')==='en'?'en':'zh-CN';
const copy={
 'zh-CN':{
  title:'五子棋实验主持人页',description:'A、B、C 套分卷与参与入口',brand:['棋间','主持'],ariaBrand:'主持人页',pill:'本机生成二维码 · 不上传参与数据',eyebrow:'FORMS A–C · HOST',hero:'两位参与者，同一套题目。',intro:'输入组号，系统会为本组分配一套卷并生成两个参与入口。两位志愿者使用同一套题。',pairTitle:'配对编号',pairIntro:'使用不含个人信息的编号，让两份导出结果可以配对。',pairLabel:'本组编号',pairHint:'依次使用 pair-001、pair-002、pair-003 等编号可轮流分到 A、B、C 套。',assignmentTitle:'分配方式',assignment:'请主持人抽签或用预先确定的方法，把两个条件链接分别给两位参与者。两台设备准备好后，由主持人统一倒数。',aiTitle:'AI 组 · AI 建议',aiIntro:'条件已锁定为AI；参与者仍会看到条件名称。',controlTitle:'对照组 · 自行复查',controlIntro:'条件已锁定为对照；练习阶段显示中性复查提示。',copyAi:'复制 AI 链接',copyControl:'复制对照链接',aiQr:'AI条件二维码',controlQr:'对照条件二维码',stepsTitle:'现场开始步骤',steps:['主持人用抽签等方式把两个条件分别给两位参与者。','参与者分别打开各自链接，在本机阅读说明并同意。','两台页面都显示“已准备，等待主持人口令”后，主持人统一倒数。','每位参与者听到口令后，在自己的设备点击“开始作答”；计时从各自点击时开始，页面不会远程同步。','结束后分别下载 JSON/CSV；通过主持人自行选择的渠道收回两个文件，再到比较页本地导入。'],compareLink:'导入两份结果并比较',footer:'A、B、C 套试跑版 · 两台设备独立保存 · 不代表正式收数',invalidPair:'请输入组号（1–40 个字母、数字、下划线或连字符，以字母或数字开头）。',fixPair:'请先修正配对编号',copySuccess:'已复制到剪贴板。',copyFail:'自动复制不可用；请点击链接或用二维码打开。',qrMissing:'本地二维码库未加载',qrFailed:'二维码生成失败',languageToggle:'English'
 },
 en:{
  title:'Gomoku Study Host Page',description:'Group allocation and entries for Forms A, B and C',brand:['Gomoku Study','Host'],ariaBrand:'Host page',pill:'QR codes generated locally · No participant data uploaded',eyebrow:'FORMS A–C · HOST',hero:'Two participants, one fixed form.',intro:'Enter a group ID to assign the same form to both participant links.',pairTitle:'Pair ID',pairIntro:'Use a non-personal identifier to match the two exported results.',pairLabel:'Pair ID for this session',pairHint:'Consecutive IDs (pair-001, pair-002, pair-003) rotate through Forms A, B and C.',assignmentTitle:'Assignment',assignment:'Assign one link to each participant by drawing lots or another pre-decided method. Give a spoken countdown when both devices are ready.',aiTitle:'AI condition',aiIntro:'The AI condition is locked; the participant will see the assigned condition.',controlTitle:'Self-review condition',controlIntro:'The control condition is locked; practice items show a neutral review prompt.',copyAi:'Copy AI link',copyControl:'Copy control link',aiQr:'AI participant link QR code',controlQr:'Control participant link QR code',stepsTitle:'Session steps',steps:['Assign one condition link to each participant using a pre-decided random method.','Each participant opens their link, reads the information, and gives consent on their own device.','When both devices show “Ready, waiting for the host”, give one spoken countdown.','After the cue, each participant clicks “Start” on their own device. Timing starts on that device; there is no remote sync.','Each participant downloads JSON/CSV. Collect the files through a channel you choose, then import them locally on the comparison page.'],compareLink:'Import two results and compare',footer:'Form A preview · Each device stores its own run · Not formal data collection',invalidPair:'Use 1–40 letters, numbers, underscores, or hyphens.',fixPair:'Please correct the pair ID',copySuccess:'Copied to clipboard.',copyFail:'Clipboard access is unavailable; open the link or scan its QR code.',qrMissing:'Local QR library did not load',qrFailed:'Could not generate this QR code',languageToggle:'中文'
 }
};
function writeText(node,value){if(node)node.textContent=value;}
function changeLanguage(next){language=next==='en'?'en':'zh-CN';const url=new URL(location.href);if(language==='en')url.searchParams.set('lang','en');else url.searchParams.delete('lang');history.replaceState({},'',url);applyLanguage();updateLinks();}
function applyLanguage(){
 const t=copy[language];document.documentElement.lang=language;document.title=t.title;document.querySelector('meta[name="description"]').content=t.description;
 const brand=$('.brand');brand.setAttribute('aria-label',t.ariaBrand);brand.href=language==='en'?'./?lang=en':'./';brand.querySelector('.brand-light').textContent=t.brand[1];brand.querySelector(':scope > span:last-child').childNodes[0].nodeValue=t.brand[0]+' ';
 $('.local-pill').lastChild.textContent=' '+t.pill;$('#language-toggle').textContent=t.languageToggle;
 $('.host-hero .eyebrow').textContent=t.eyebrow;$('.host-hero h1').innerHTML=language==='en'?'Two participants, <em>one fixed form.</em>':'两位参与者，<em>同一套题目。</em>';$('.host-hero p:last-child').textContent=t.intro;
 const cards=document.querySelectorAll('.host-main > .host-card');writeText(cards[0].querySelector('h2'),t.pairTitle);writeText(cards[0].querySelector('p'),t.pairIntro);document.querySelector('label[for="pair-id"]').textContent=t.pairLabel;writeText(cards[0].querySelector('.host-note'),t.pairHint);writeText(cards[0].querySelector('.host-random-note strong'),t.assignmentTitle);writeText(cards[0].querySelector('.host-random-note span'),t.assignment);
 const participants=document.querySelectorAll('.participant-card');for(const condition of ['AI','control']){const card=participants[condition==='AI'?0:1];writeText(card.querySelector('h2'),condition==='AI'?t.aiTitle:t.controlTitle);writeText(card.querySelector('p'),condition==='AI'?t.aiIntro:t.controlIntro);writeText(card.querySelector('button'),condition==='AI'?t.copyAi:t.copyControl);card.querySelector('.qr-frame').setAttribute('aria-label',condition==='AI'?t.aiQr:t.controlQr);}
 const steps=document.querySelector('.host-steps');writeText(steps.querySelector('h2'),t.stepsTitle);steps.querySelectorAll('li').forEach((item,index)=>writeText(item,t.steps[index]));const compareEntry=$('.compare-entry');writeText(compareEntry,t.compareLink);compareEntry.href=language==='en'?'./compare.html?lang=en':'./compare.html';$('.host-footer').textContent=t.footer;
 status.AI.textContent='';status.control.textContent='';
}
const initialPair = new URLSearchParams(location.search).get('pair_id');
if (isPairId(initialPair)) pairInput.value=initialPair;

function makeUrl(condition, pairId, formId) {
  const url=new URL('./experiment.html',import.meta.url);
  url.searchParams.set('mode','pilot_link');
  url.searchParams.set('condition',condition);
  url.searchParams.set('pair_id',pairId);
  url.searchParams.set('form',formId);
  if(language==='en') url.searchParams.set('lang','en');
  return url.href;
}
function drawQr(condition,url){const target=qrContainers[condition];target.replaceChildren();try{if(typeof globalThis.qrcode!=='function')throw new Error(copy[language].qrMissing);const code=globalThis.qrcode(0,'M');code.addData(url,'Byte');code.make();const template=document.createElement('template');template.innerHTML=code.createSvgTag({cellSize:4,margin:4,scalable:true});const svg=template.content.querySelector('svg');if(!svg)throw new Error(copy[language].qrFailed);svg.setAttribute('role','img');svg.setAttribute('aria-label',condition==='AI'?copy[language].aiQr:copy[language].controlQr);target.append(template.content);}catch(error){const note=document.createElement('p');note.className='qr-error';note.textContent=error.message===copy[language].qrMissing?copy[language].qrMissing:copy[language].qrFailed;target.append(note);}}
function updateLinks() {
 const pairId=pairInput.value.trim(), valid=isPairId(pairId);
 const formId=valid?formForPair(pairId):null;
 pairInput.setCustomValidity(valid?'':copy[language].invalidPair);
 $('#assigned-form').textContent=!formId?'':language==='en'
   ? `Assigned form: ${formId}${formId==='A'?'':' (pilot)'}`
   : `本组试卷：${formId} 套${formId==='A'?'':'（预试）'}`;
 if(valid){
   const url=new URL(location.href);
   url.searchParams.set('pair_id',pairId);
   history.replaceState({},'',url);
 }
 for(const condition of ['AI','control']){
   status[condition].textContent='';
   $(condition==='AI'?'#copy-ai':'#copy-control').disabled=!valid;
   if(!valid){
     links[condition].removeAttribute('href');
     links[condition].textContent=copy[language].fixPair;
     qrContainers[condition].replaceChildren();
     continue;
   }
   const url=makeUrl(condition,pairId,formId);
   links[condition].href=url;
   links[condition].textContent=url;
   drawQr(condition,url);
 }
}
async function copyLink(condition){status[condition].textContent='';try{await navigator.clipboard.writeText(links[condition].href);status[condition].textContent=copy[language].copySuccess;}catch{status[condition].textContent=copy[language].copyFail;}}
pairInput.addEventListener('input',updateLinks);$('#copy-ai').addEventListener('click',()=>copyLink('AI'));$('#copy-control').addEventListener('click',()=>copyLink('control'));$('#language-toggle').addEventListener('click',()=>changeLanguage(language==='en'?'zh-CN':'en'));applyLanguage();updateLinks();
