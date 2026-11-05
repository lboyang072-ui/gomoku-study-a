const $=selector=>document.querySelector(selector);
const pairInput=$('#pair-id');
const status={AI:$('#ai-copy-status'),control:$('#control-copy-status')};
const links={AI:$('#ai-link'),control:$('#control-link')};
const qrContainers={AI:$('#ai-qr'),control:$('#control-qr')};

function makeUrl(condition){
  const url=new URL('./experiment.html',import.meta.url);
  url.searchParams.set('mode','pilot_link');
  url.searchParams.set('condition',condition);
  const pairId=pairInput.value.trim();
  if(pairId)url.searchParams.set('pair_id',pairId);else url.searchParams.delete('pair_id');
  return url.href;
}
function drawQr(condition,url){
  const target=qrContainers[condition];target.replaceChildren();
  try{
    if(typeof globalThis.qrcode!=='function')throw new Error('本地二维码库未加载');
    const code=globalThis.qrcode(0,'M');code.addData(url,'Byte');code.make();
    const template=document.createElement('template');template.innerHTML=code.createSvgTag({cellSize:4,margin:4,scalable:true});
    const svg=template.content.querySelector('svg');if(!svg)throw new Error('二维码生成失败');
    svg.setAttribute('role','img');svg.setAttribute('aria-label',condition==='AI'?'AI建议参与链接二维码':'自行复查参与链接二维码');target.append(template.content);
  }catch(error){const note=document.createElement('p');note.className='qr-error';note.textContent=error.message;target.append(note);}
}
function updateLinks(){
  const pairId=pairInput.value.trim(),valid=!pairId||/^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/.test(pairId);
  pairInput.setCustomValidity(valid?'':'编号仅允许1到40位字母、数字、下划线和连字符。');
  if(!valid){for(const condition of ['AI','control']){qrContainers[condition].replaceChildren();links[condition].textContent='请先修正配对编号';links[condition].removeAttribute('href');}return;}
  for(const condition of ['AI','control']){const url=makeUrl(condition);links[condition].href=url;links[condition].textContent=url;drawQr(condition,url);}
}
async function copyLink(condition){
  status[condition].textContent='';
  try{await navigator.clipboard.writeText(links[condition].href);status[condition].textContent='已复制到剪贴板。';}
  catch{status[condition].textContent='自动复制不可用；请点击链接或用二维码打开。';}
}
pairInput.addEventListener('input',updateLinks);
$('#copy-ai').addEventListener('click',()=>copyLink('AI'));
$('#copy-control').addEventListener('click',()=>copyLink('control'));
updateLinks();
