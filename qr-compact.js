(()=>{
'use strict';
const DATA=window.NVQPLUS_COURSE_DATA;
const NativeQRCode=window.QRCode;
const nativeJsQR=window.jsQR;
if(!DATA||!NativeQRCode||!nativeJsQR)return;
function criteria(unit){return unit.learningOutcomes.flatMap(lo=>lo.criteria);}
function b64(bytes){let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
function unb64(text){const s=String(text||'').replace(/-/g,'+').replace(/_/g,'/');const bin=atob(s+'='.repeat((4-s.length%4)%4));return Uint8Array.from(bin,c=>c.charCodeAt(0));}
function compact(text){
  let p;try{p=JSON.parse(text);}catch(e){return text;}
  if(p.a!=='NVQPlus'||p.v!==1||!p.lid)return text;
  const status={evidence:1,assessed:2,topup:3},d={};
  for(const [uid,rec] of Object.entries(p.u||{})){
    const unit=DATA.units.find(u=>u.id===uid);if(!unit)continue;
    const list=criteria(unit),bytes=new Uint8Array(Math.ceil(list.length/4));let any=false;
    list.forEach((c,i)=>{const x=rec[c.id],code=status[x?.s]||0;if(code){bytes[Math.floor(i/4)]|=(code&3)<<((i%4)*2);any=true;}});
    const rule=DATA.specialRules[uid];let mask=0;
    if(rule){const x=rec[rule.criterion],c=list.find(y=>y.id===rule.criterion);(c?.subItems||[]).forEach((it,i)=>{if((x?.i||[]).includes(it.label))mask|=(1<<i);});if(x?.f)mask|=256;if(mask)any=true;}
    if(any)d[uid]=[b64(bytes),mask];
  }
  return JSON.stringify({a:'N',v:2,b:p.by||'',l:p.lid,o:p.ou||'',d});
}
function expand(text){
  let p;try{p=JSON.parse(text);}catch(e){return text;}
  if(p.a!=='N'||p.v!==2||!p.l)return text;
  const names=['','evidence','assessed','topup'],u={};
  for(const [uid,pack] of Object.entries(p.d||{})){
    const unit=DATA.units.find(x=>x.id===uid);if(!unit)continue;
    let bytes;try{bytes=unb64(pack[0]);}catch(e){continue;}
    const list=criteria(unit),rec={};
    list.forEach((c,i)=>{const code=((bytes[Math.floor(i/4)]||0)>>((i%4)*2))&3;if(code)rec[c.id]={s:names[code],i:[],f:false};});
    const rule=DATA.specialRules[uid],mask=Number(pack[1]||0);
    if(rule&&mask){const c=list.find(x=>x.id===rule.criterion),x=rec[rule.criterion]||(rec[rule.criterion]={s:'',i:[],f:false});x.i=(c?.subItems||[]).filter((it,i)=>mask&(1<<i)).map(it=>it.label);x.f=!!(mask&256);}
    if(Object.keys(rec).length)u[uid]=rec;
  }
  return JSON.stringify({a:'NVQPlus',v:1,by:p.b||'',lid:p.l,ou:p.o||'',u});
}
function QRCodeProxy(el,options){
  if(!(this instanceof QRCodeProxy))return new QRCodeProxy(el,options);
  if(typeof options==='string')options=compact(options);else if(options&&typeof options==='object')options={...options,text:compact(options.text)};
  return new NativeQRCode(el,options);
}
QRCodeProxy.CorrectLevel=NativeQRCode.CorrectLevel;
QRCodeProxy.prototype=NativeQRCode.prototype;
window.QRCode=QRCodeProxy;
window.jsQR=function(...args){const result=nativeJsQR(...args);if(result&&result.data)result.data=expand(result.data);return result;};
})();
