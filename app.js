(()=>{
'use strict';
const DATA=window.NVQPLUS_COURSE_DATA;
const app=document.getElementById('app');
const photoInput=document.getElementById('photoInput');
const audioInput=document.getElementById('audioInput');
const qrImageInput=document.getElementById('qrImageInput');
const STATE_KEY='nvqplus-state-v1';
const DB_NAME='nvqplus-evidence-v1';
let state=loadState();
let view='home';
let selectedUnitId=null;
let selectedTab='practical';
let assessorUnlocked=false;
let pendingEvidence=null;
let scanStream=null;
let scanTimer=null;

function uid(){return (crypto.randomUUID?crypto.randomUUID():'id-'+Date.now()+'-'+Math.random().toString(36).slice(2));}
function esc(v){return String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));}
function safeName(v){return String(v||'NVQPlus').replace(/[^a-z0-9._-]+/gi,'-').replace(/^-+|-+$/g,'');}
function blankState(){return {role:null,apprentice:{learnerId:uid(),name:'',optionalUnit:'',records:{},signatures:{}},assessor:{selectedLearnerId:null,learners:{}}};}
function loadState(){try{const x=JSON.parse(localStorage.getItem(STATE_KEY));if(x&&x.apprentice&&x.assessor)return x;}catch(e){}return blankState();}
function saveState(){localStorage.setItem(STATE_KEY,JSON.stringify(state));}
function unitById(id){return DATA.units.find(u=>u.id===id);}
function allCriteria(unit){return unit.learningOutcomes.flatMap(lo=>lo.criteria.map(c=>({...c,loId:lo.id,loWording:lo.wording})));}
function getActiveLearner(){
  if(state.role==='apprentice') return state.apprentice;
  if(state.role==='assessor'&&state.assessor.selectedLearnerId) return state.assessor.learners[state.assessor.selectedLearnerId]||null;
  return null;
}
function applicableUnits(learner){
  const ids=[...DATA.course.mandatoryUnitIds];
  if(learner?.optionalUnit&&!ids.includes(learner.optionalUnit))ids.push(learner.optionalUnit);
  return ids.map(unitById).filter(Boolean);
}
function ensureUnitRecord(learner,unitId){
  learner.records=learner.records||{};
  learner.records[unitId]=learner.records[unitId]||{criteria:{}};
  return learner.records[unitId];
}
function criterionState(learner,unitId,cid){
  const r=ensureUnitRecord(learner,unitId);
  r.criteria[cid]=r.criteria[cid]||{status:'',subItems:[],fixed:false,evidenceIds:[]};
  return r.criteria[cid];
}
function specialSatisfied(unitId,cid,cs){
  const rule=DATA.specialRules[unitId];
  if(!rule||rule.criterion!==cid)return true;
  if((cs.subItems||[]).length<rule.minimumSubItems)return false;
  if(rule.fixedRequired&&!cs.fixed)return false;
  return true;
}
function criterionDone(unitId,cid,cs){return (cs.status==='assessed'||cs.status==='evidence')&&specialSatisfied(unitId,cid,cs);}
function unitStats(learner,unit){
  const criteria=allCriteria(unit);let done=0,topup=0,evidence=0,assessed=0;
  for(const c of criteria){const cs=criterionState(learner,unit.id,c.id);if(criterionDone(unit.id,c.id,cs))done++;if(cs.status==='topup')topup++;if(cs.status==='evidence')evidence++;if(cs.status==='assessed')assessed++;}
  return {total:criteria.length,done,topup,evidence,assessed,pct:criteria.length?Math.round(done/criteria.length*100):0};
}
function statusBadge(stats){
  if(stats.pct===100)return '<span class="badge good">Complete</span>';
  if(stats.topup)return '<span class="badge topup">Top-up required</span>';
  if(stats.done)return '<span class="badge warn">In progress</span>';
  return '<span class="badge">Not started</span>';
}
function shell(content,actions=''){
  const mode=state.role?`<span class="badge ${state.role==='assessor'?'blue':''}">${state.role==='assessor'?'Assessor':'Apprentice'}</span>`:'';
  app.innerHTML=`<div class="shell"><div class="topbar"><div><div class="brand">NVQPlus</div><div class="subtitle">${esc(DATA.course.qualificationNumber)} · ${esc(DATA.course.title)}</div></div><div class="row">${mode}${actions}</div></div>${content}<div id="toastHost"></div></div>`;
}
function toast(msg){const old=document.querySelector('.toast');if(old)old.remove();const d=document.createElement('div');d.className='toast';d.textContent=msg;document.body.appendChild(d);setTimeout(()=>d.remove(),2400);}
function setView(v){view=v;render();}

function render(){
  if(view==='home')return renderHome();
  if(view==='assessorPassword')return renderAssessorPassword();
  if(view==='apprenticeSetup')return renderApprenticeSetup();
  if(view==='assessorLearners')return renderAssessorLearners();
  if(view==='addLearner')return renderAddLearner();
  if(view==='units')return renderUnits();
  if(view==='unit')return renderUnit();
  renderHome();
}
function renderHome(){
  state.role=null;selectedUnitId=null;
  shell(`<div class="card"><div class="eyebrow">Choose mode</div><div class="section-title">How are you using NVQPlus?</div><div class="hint">Both modes use the same unit packs. Assessor mode adds learner selection and assessment decisions.</div></div><div class="grid2" style="margin-top:12px"><button id="roleApprentice" class="role-card"><strong>Apprentice</strong><span>Gather practical and theory evidence, receive top-ups, sign and download unit packs.</span></button><button id="roleAssessor" class="role-card"><strong>Assessor</strong><span>Select learners, record assessment decisions and exchange progress by QR.</span></button></div>`);
  document.getElementById('roleApprentice').onclick=()=>{state.role='apprentice';saveState();view=state.apprentice.name?'units':'apprenticeSetup';render();};
  document.getElementById('roleAssessor').onclick=()=>{view='assessorPassword';render();};
}
function renderAssessorPassword(){
  shell(`<div class="card"><div class="eyebrow">Assessor access</div><div class="section-title">Enter password</div><form id="assessorPassForm" class="stack" style="margin-top:12px"><label class="field">Password<input id="assessorPass" class="input" type="password" inputmode="numeric" autocomplete="off"></label><div id="passError" class="error"></div><div class="row"><button class="btn primary" type="submit">Continue</button><button id="passBack" class="btn" type="button">Back</button></div></form></div>`);
  document.getElementById('passBack').onclick=()=>setView('home');
  document.getElementById('assessorPassForm').onsubmit=e=>{e.preventDefault();if(document.getElementById('assessorPass').value==='1984'){assessorUnlocked=true;state.role='assessor';saveState();view='assessorLearners';render();}else document.getElementById('passError').textContent='Incorrect password.';};
}
function optionalOptions(selected=''){return DATA.course.optionalUnitIds.map(id=>{const u=unitById(id);return `<option value="${id}" ${selected===id?'selected':''}>Unit ${id} — ${esc(u.title)}</option>`;}).join('');}
function renderApprenticeSetup(){
  shell(`<div class="card"><div class="eyebrow">Apprentice setup</div><div class="section-title">Set up your course</div><form id="setupForm" class="stack" style="margin-top:12px"><label class="field">Full name<input id="setupName" class="input" value="${esc(state.apprentice.name)}" autocomplete="name" required></label><label class="field">Optional unit<select id="setupOptional" class="input" required><option value="">Choose one</option>${optionalOptions(state.apprentice.optionalUnit)}</select></label><button class="btn primary full" type="submit">Start NVQPlus</button></form></div>`,'<button id="switchMode" class="btn small">Switch mode</button>');
  document.getElementById('switchMode').onclick=()=>setView('home');
  document.getElementById('setupForm').onsubmit=e=>{e.preventDefault();const n=document.getElementById('setupName').value.trim(),o=document.getElementById('setupOptional').value;if(!n||!o)return;state.apprentice.name=n;state.apprentice.optionalUnit=o;saveState();view='units';render();};
}
function renderAssessorLearners(){
  if(!assessorUnlocked){view='assessorPassword';return render();}
  const learners=Object.values(state.assessor.learners||{});
  shell(`<div class="card"><div class="space"><div><div class="eyebrow">Assessor</div><div class="section-title">Learners</div><div class="hint">Learner names are stored only on this device. QR codes use the learner device ID, not their name.</div></div><button id="addLearner" class="btn small primary">Add learner</button></div><div class="row" style="margin-top:12px"><button id="scanLearner" class="btn soft">Scan learner QR</button><button id="importLearnerQR" class="btn">Import QR image</button></div></div><div class="stack" style="margin-top:12px">${learners.length?learners.map(l=>{const units=applicableUnits(l);const done=units.filter(u=>unitStats(l,u).pct===100).length;return `<button class="unit-card learnerPick" data-id="${esc(l.learnerId)}"><div class="space"><div><div class="unit-title">${esc(l.name||'Unnamed learner')}</div><div class="unit-meta">${done} of ${units.length} units complete</div></div><span class="badge">Open</span></div></button>`;}).join(''):'<div class="card empty">No learners yet. Add one manually or scan an apprentice QR.</div>'}</div>`,'<button id="switchMode" class="btn small">Switch mode</button>');
  document.getElementById('switchMode').onclick=()=>{assessorUnlocked=false;setView('home');};
  document.getElementById('addLearner').onclick=()=>setView('addLearner');
  document.getElementById('scanLearner').onclick=()=>openScanner();
  document.getElementById('importLearnerQR').onclick=()=>qrImageInput.click();
  document.querySelectorAll('.learnerPick').forEach(b=>b.onclick=()=>{state.assessor.selectedLearnerId=b.dataset.id;saveState();view='units';render();});
}
function renderAddLearner(){
  shell(`<div class="card"><div class="eyebrow">Assessor</div><div class="section-title">Add learner</div><form id="addLearnerForm" class="stack" style="margin-top:12px"><label class="field">Learner name<input id="newLearnerName" class="input" required></label><label class="field">Optional unit<select id="newLearnerOptional" class="input" required><option value="">Choose one</option>${optionalOptions()}</select></label><div class="row"><button class="btn primary" type="submit">Add learner</button><button id="cancelAdd" class="btn" type="button">Cancel</button></div></form></div>`);
  document.getElementById('cancelAdd').onclick=()=>setView('assessorLearners');
  document.getElementById('addLearnerForm').onsubmit=e=>{e.preventDefault();const name=document.getElementById('newLearnerName').value.trim(),optional=document.getElementById('newLearnerOptional').value;if(!name||!optional)return;const id=uid();state.assessor.learners[id]={learnerId:id,name,optionalUnit:optional,records:{},signatures:{}};state.assessor.selectedLearnerId=id;saveState();view='units';render();};
}
function renderUnits(){
  const learner=getActiveLearner();if(!learner){view=state.role==='assessor'?'assessorLearners':'apprenticeSetup';return render();}
  const units=applicableUnits(learner);
  shell(`<div class="card"><div class="space"><div><div class="eyebrow">${state.role==='assessor'?'Selected learner':'My course'}</div><div class="section-title">${esc(learner.name)}</div><div class="hint">One unit = one evidence pack. Practical and theory ACs use the official City & Guilds wording.</div></div>${state.role==='assessor'?'<button id="backLearners" class="btn small">Learners</button>':''}</div><div class="row" style="margin-top:12px"><button id="showProgressQR" class="btn soft">Show progress QR</button><button id="scanUpdateQR" class="btn">Scan update QR</button><button id="importUpdateQR" class="btn">Import QR image</button></div></div><div class="stack" style="margin-top:12px">${units.map(u=>{const s=unitStats(learner,u);return `<button class="unit-card openUnit" data-id="${u.id}"><div class="space"><div><div class="unit-title">Unit ${u.id} — ${esc(u.title)}</div><div class="unit-meta">${u.mandatory?'Mandatory':'Optional'} · ${s.done}/${s.total} ACs evidenced/assessed</div><div class="status-line">${statusBadge(s)}</div></div><strong>${s.pct}%</strong></div><div class="progress"><span style="width:${s.pct}%"></span></div></button>`;}).join('')}</div>`,'<button id="switchMode" class="btn small">Switch mode</button>');
  if(document.getElementById('backLearners'))document.getElementById('backLearners').onclick=()=>setView('assessorLearners');
  document.getElementById('switchMode').onclick=()=>{assessorUnlocked=false;setView('home');};
  document.querySelectorAll('.openUnit').forEach(b=>b.onclick=()=>{selectedUnitId=b.dataset.id;selectedTab='practical';view='unit';render();});
  document.getElementById('showProgressQR').onclick=()=>showQR(makeSnapshot());
  document.getElementById('scanUpdateQR').onclick=()=>openScanner();
  document.getElementById('importUpdateQR').onclick=()=>qrImageInput.click();
}
function criterionStatusHtml(unitId,cid,cs){
  if(cs.status==='assessed')return '<span class="pill assessed">Assessed</span>';
  if(cs.status==='topup')return '<span class="pill topup">Top-up</span>';
  if(cs.status==='evidence')return `<span class="pill evidence">Evidence added${specialSatisfied(unitId,cid,cs)?'':' · partial'}</span>`;
  return '';
}
function activityHtml(unit,lo,type,onlyTopup=false){
  const learner=getActiveLearner();
  let cs=lo.criteria.filter(c=>c.evidenceClass===type);
  if(onlyTopup)cs=lo.criteria.filter(c=>c.evidenceClass===type&&criterionState(learner,unit.id,c.id).status==='topup');
  if(!cs.length)return '';
  const rule=DATA.specialRules[unit.id];
  return `<section class="activity"><h3>Learning Outcome ${esc(lo.id)}</h3><div class="lo">${esc(lo.wording)}</div>${cs.map(c=>{
    const st=criterionState(learner,unit.id,c.id);const isSpecial=rule&&rule.criterion===c.id;
    return `<div class="criterion"><div class="criterion-head"><input class="criterion-map" type="checkbox" data-cid="${esc(c.id)}" aria-label="Select AC ${esc(c.id)}"><div class="criterion-id">${esc(c.id)}</div><div class="criterion-text">${esc(c.wording)}<div class="mini-map">${criterionStatusHtml(unit.id,c.id,st)}</div></div></div>${c.subItems?.length?`<div class="subitems">${isSpecial&&rule.fixedRequired?`<label class="subitem"><input class="fixed-map" type="checkbox" data-cid="${esc(c.id)}" ${st.fixed?'checked':''}><span>${esc(rule.fixedRequirementText)}</span></label>`:''}${c.subItems.map(s=>`<label class="subitem"><input class="subitem-map" type="checkbox" data-cid="${esc(c.id)}" data-sub="${esc(s.label)}" ${(st.subItems||[]).includes(s.label)?'checked':''}><span><strong>${esc(s.label)}</strong> ${esc(s.text)}</span></label>`).join('')}${isSpecial?`<div class="notice">${esc(rule.label)}. Recorded so far: ${(st.subItems||[]).length}${rule.fixedRequired?` · fixed requirement ${st.fixed?'recorded':'not yet recorded'}`:''}.</div>`:''}</div>`:''}</div>`;
  }).join('')}<div class="evidence-actions"><button class="btn small evidenceAction" data-kind="photo">Photos</button><button class="btn small evidenceAction" data-kind="written">Written</button><button class="btn small evidenceAction" data-kind="audio">Audio</button>${state.role==='assessor'?'<button class="btn small good assessorAction" data-action="assessed">Mark assessed</button><button class="btn small danger assessorAction" data-action="topup">Top-up required</button>':''}</div></section>`;
}
function renderUnit(){
  const learner=getActiveLearner(),unit=unitById(selectedUnitId);if(!learner||!unit){view='units';return render();}
  const stats=unitStats(learner,unit);
  const practical=unit.learningOutcomes.map(lo=>activityHtml(unit,lo,'practical')).join('');
  const theory=unit.learningOutcomes.map(lo=>activityHtml(unit,lo,'knowledge')).join('');
  const topup=unit.learningOutcomes.map(lo=>activityHtml(unit,lo,'knowledge',true)+activityHtml(unit,lo,'practical',true)).join('');
  shell(`<div class="card"><div class="space"><div><div class="eyebrow">Unit ${unit.id}</div><div class="section-title">${esc(unit.title)}</div><div class="status-line">${statusBadge(stats)}</div></div><strong>${stats.pct}%</strong></div><div class="progress"><span style="width:${stats.pct}%"></span></div><div class="summary-grid" style="margin-top:12px"><div class="metric"><strong>${stats.done}</strong><span>ACs evidenced/assessed</span></div><div class="metric"><strong>${stats.assessed}</strong><span>Assessed</span></div><div class="metric"><strong>${stats.evidence}</strong><span>Evidence added</span></div><div class="metric"><strong>${stats.topup}</strong><span>Top-up</span></div></div></div><div class="tabs" style="margin-top:12px"><button class="tab ${selectedTab==='practical'?'active':''}" data-tab="practical">Practical</button><button class="tab ${selectedTab==='theory'?'active':''}" data-tab="theory">Theory</button><button class="tab ${selectedTab==='topup'?'active':''}" data-tab="topup">Top-up</button><button class="tab ${selectedTab==='evidence'?'active':''}" data-tab="evidence">Evidence</button><button class="tab ${selectedTab==='pack'?'active':''}" data-tab="pack">Pack</button></div><div id="tabContent" class="stack" style="margin-top:12px">${selectedTab==='practical'?(practical||'<div class="card empty">No practical ACs in this unit.</div>'):selectedTab==='theory'?(theory||'<div class="card empty">No theory ACs in this unit.</div>'):selectedTab==='topup'?(topup||'<div class="card empty">No top-up ACs are currently outstanding.</div>'):selectedTab==='evidence'?'<div class="card"><div class="section-title">Evidence in this unit</div><div id="evidenceList" class="stack"><div class="hint">Loading evidence…</div></div></div>':packHtml(learner,unit,stats)}</div>`,'<button id="backUnits" class="btn small">Units</button>');
  document.getElementById('backUnits').onclick=()=>setView('units');
  document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>{selectedTab=b.dataset.tab;render();});
  document.querySelectorAll('.evidenceAction').forEach(b=>b.onclick=()=>beginEvidence(b.dataset.kind,unit));
  document.querySelectorAll('.assessorAction').forEach(b=>b.onclick=()=>assessorBulkDecision(b.dataset.action,unit));
  if(selectedTab==='evidence')renderEvidenceList(unit);
  if(selectedTab==='pack')initSignature(unit);
}
function collectSelections(unit){
  const selected=[];
  document.querySelectorAll('.criterion-map:checked').forEach(cb=>{
    const cid=cb.dataset.cid;const subs=[...document.querySelectorAll(`.subitem-map[data-cid="${CSS.escape(cid)}"]:checked`)].map(x=>x.dataset.sub);
    const fixed=!!document.querySelector(`.fixed-map[data-cid="${CSS.escape(cid)}"]:checked`);
    selected.push({cid,subItems:subs,fixed});
  });
  if(!selected.length)toast('Select at least one AC first.');
  return selected;
}
function mergeCoverage(cs,sel){cs.subItems=[...new Set([...(cs.subItems||[]),...(sel.subItems||[])])];if(sel.fixed)cs.fixed=true;}
function assessorBulkDecision(action,unit){
  const learner=getActiveLearner(),sels=collectSelections(unit);if(!sels.length)return;
  sels.forEach(s=>{const cs=criterionState(learner,unit.id,s.cid);mergeCoverage(cs,s);cs.status=action;});saveState();toast(action==='assessed'?'Selected ACs marked assessed.':'Selected ACs marked for top-up.');render();
}
function beginEvidence(kind,unit){
  const sels=collectSelections(unit);if(!sels.length)return;pendingEvidence={kind,unitId:unit.id,selections:sels};
  if(kind==='photo'){photoInput.value='';photoInput.click();return;}
  if(kind==='audio'){audioInput.value='';audioInput.click();return;}
  openWrittenModal();
}
function openWrittenModal(){
  const back=document.createElement('div');back.className='modal-backdrop';back.innerHTML=`<div class="modal"><h2>Add written evidence</h2><div class="hint">Mapped to ${pendingEvidence.selections.map(s=>'['+esc(s.cid)+']').join(' ')}</div><label class="field" style="margin-top:12px">Written evidence<textarea id="writtenEvidenceText" class="input" placeholder="Write the evidence here"></textarea></label><div class="row" style="margin-top:12px"><button id="saveWritten" class="btn primary">Save evidence</button><button id="cancelWritten" class="btn">Cancel</button></div></div>`;document.body.appendChild(back);
  back.querySelector('#cancelWritten').onclick=()=>{pendingEvidence=null;back.remove();};
  back.querySelector('#saveWritten').onclick=async()=>{const text=back.querySelector('#writtenEvidenceText').value.trim();if(!text){toast('Add written evidence first.');return;}await saveEvidenceItem({kind:'written',text,name:'Written evidence'});back.remove();};
}
photoInput.addEventListener('change',async()=>{if(!pendingEvidence||!photoInput.files?.length)return;for(const f of photoInput.files){const blob=await compressImage(f);await saveEvidenceItem({kind:'photo',blob,name:f.name||'Photo.jpg',mimeType:'image/jpeg'},false);}finishEvidence();});
audioInput.addEventListener('change',async()=>{if(!pendingEvidence||!audioInput.files?.[0])return;const f=audioInput.files[0];await saveEvidenceItem({kind:'audio',blob:f,name:f.name||'Audio evidence',mimeType:f.type||'audio/mpeg'},false);finishEvidence();});
async function compressImage(file){
  try{const bmp=await createImageBitmap(file);const max=1600,scale=Math.min(1,max/Math.max(bmp.width,bmp.height));const c=document.createElement('canvas');c.width=Math.round(bmp.width*scale);c.height=Math.round(bmp.height*scale);c.getContext('2d').drawImage(bmp,0,0,c.width,c.height);return await new Promise(r=>c.toBlob(r,'image/jpeg',.8));}catch(e){return file;}
}
async function saveEvidenceItem(extra,finish=true){
  const learner=getActiveLearner(),p=pendingEvidence;if(!learner||!p)return;
  const id=uid();const item={id,learnerId:learner.learnerId,unitId:p.unitId,kind:p.kind,createdAt:new Date().toISOString(),criteria:p.selections,authorRole:state.role,...extra};await dbPut(item);
  for(const s of p.selections){const cs=criterionState(learner,p.unitId,s.cid);mergeCoverage(cs,s);cs.evidenceIds=cs.evidenceIds||[];cs.evidenceIds.push(id);cs.status='evidence';}
  saveState();if(finish)finishEvidence();
}
function finishEvidence(){pendingEvidence=null;toast('Evidence saved to this unit pack.');render();}

function packHtml(learner,unit,stats){
  const sig=learner.signatures?.[unit.id];
  return `<div class="card"><div class="section-title">Unit pack</div><div class="hint">The PDF contains the AC mapping, written evidence, photographs, audio files as PDF attachments, assessment status and the apprentice signature.</div><div class="summary-grid" style="margin-top:12px"><div class="metric"><strong>${stats.done}/${stats.total}</strong><span>ACs</span></div><div class="metric"><strong>${stats.topup}</strong><span>Top-up</span></div><div class="metric"><strong>${sig?'Yes':'No'}</strong><span>Signed</span></div><div class="metric"><strong>PDF</strong><span>Single pack</span></div></div></div><div class="card"><div class="section-title">Apprentice signature</div><div class="hint">The apprentice must sign before this unit can be downloaded.</div><div class="signature-wrap" style="margin-top:12px"><canvas id="signatureCanvas" width="760" height="170"></canvas><div class="signature-tools"><span class="hint">Sign in the box</span><button id="clearSignature" class="btn small" type="button">Clear</button></div></div>${sig?`<div class="notice" style="margin-top:10px">Signed by ${esc(learner.name)} on ${new Date(sig.signedAt).toLocaleString()}.</div>`:''}<button id="downloadPack" class="btn primary full" style="margin-top:12px" ${sig?'':'disabled'}>Download unit PDF</button><div class="footer-note">Official AC wording is preserved in the pack. Assessor decisions in NVQPlus support your mapping workflow; the final assessment decision remains with the assessor.</div></div>`;
}
function initSignature(unit){
  const learner=getActiveLearner(),canvas=document.getElementById('signatureCanvas');if(!canvas)return;const ctx=canvas.getContext('2d');ctx.lineWidth=3;ctx.lineCap='round';ctx.strokeStyle='#111';let drawing=false,dirty=false;
  if(learner.signatures?.[unit.id]?.dataUrl){const im=new Image();im.onload=()=>ctx.drawImage(im,0,0,canvas.width,canvas.height);im.src=learner.signatures[unit.id].dataUrl;}
  function pos(e){const r=canvas.getBoundingClientRect();return {x:(e.clientX-r.left)*(canvas.width/r.width),y:(e.clientY-r.top)*(canvas.height/r.height)};}
  canvas.onpointerdown=e=>{drawing=true;dirty=true;canvas.setPointerCapture(e.pointerId);const p=pos(e);ctx.beginPath();ctx.moveTo(p.x,p.y);};
  canvas.onpointermove=e=>{if(!drawing)return;const p=pos(e);ctx.lineTo(p.x,p.y);ctx.stroke();};
  canvas.onpointerup=()=>{if(!drawing)return;drawing=false;if(dirty){learner.signatures=learner.signatures||{};learner.signatures[unit.id]={dataUrl:canvas.toDataURL('image/png'),signedAt:new Date().toISOString()};saveState();document.getElementById('downloadPack').disabled=false;toast('Signature saved.');}};
  document.getElementById('clearSignature').onclick=()=>{ctx.clearRect(0,0,canvas.width,canvas.height);if(learner.signatures)delete learner.signatures[unit.id];saveState();document.getElementById('downloadPack').disabled=true;toast('Signature cleared.');};
  document.getElementById('downloadPack').onclick=()=>downloadPDF(learner,unit);
}

async function renderEvidenceList(unit){
  const learner=getActiveLearner(),host=document.getElementById('evidenceList');if(!host)return;const items=(await dbAll()).filter(x=>x.learnerId===learner.learnerId&&x.unitId===unit.id).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  host.innerHTML=items.length?items.map(x=>`<div class="evidence-item"><strong>${x.kind==='photo'?'Photo':x.kind==='audio'?'Audio':'Written'} evidence</strong><div class="meta">${new Date(x.createdAt).toLocaleString()} · ${x.criteria.map(c=>'['+esc(c.cid)+']').join(' ')}</div>${x.text?`<div class="body">${esc(x.text)}</div>`:''}${x.kind!=='written'?`<div class="body">${esc(x.name||'Evidence file')}</div>`:''}</div>`).join(''):'<div class="empty">No local evidence files have been added to this unit yet.</div>';
}

function makeSnapshot(){
  const l=getActiveLearner();const units={};
  for(const [uid,r] of Object.entries(l.records||{})){const o={};for(const [cid,cs] of Object.entries(r.criteria||{})){if(!cs.status&&!cs.subItems?.length&&!cs.fixed)continue;o[cid]={s:cs.status||'',i:cs.subItems||[],f:!!cs.fixed};}if(Object.keys(o).length)units[uid]=o;}
  return JSON.stringify({a:'NVQPlus',v:1,by:state.role==='assessor'?'R':'A',lid:l.learnerId,ou:l.optionalUnit,u:units});
}
function showQR(payload){
  const back=document.createElement('div');back.className='modal-backdrop';back.innerHTML=`<div class="modal"><div class="space"><div><h2>${state.role==='assessor'?'Assessor update QR':'Apprentice progress QR'}</h2><div class="hint">Contains progress and AC status only. It does not contain the learner name, photographs, audio or written evidence.</div></div><button id="closeQR" class="btn small">Close</button></div><div id="qrBox" class="qrbox"></div><div class="footer-note">Scan this on the other phone to transfer the current mapping status.</div></div>`;document.body.appendChild(back);back.querySelector('#closeQR').onclick=()=>back.remove();
  try{new QRCode(back.querySelector('#qrBox'),{text:payload,width:290,height:290,correctLevel:QRCode.CorrectLevel.L});}catch(e){back.querySelector('#qrBox').innerHTML='<div class="error">The QR payload is too large. Reduce the amount of transferred status and try again.</div>';}
}
function openScanner(){
  if(!window.jsQR){toast('QR scanner library is not available. Use Import QR image.');return;}
  const back=document.createElement('div');back.className='modal-backdrop';back.innerHTML=`<div class="modal"><div class="space"><div><h2>Scan NVQPlus QR</h2><div class="hint">Point the camera at the QR shown on the other phone.</div></div><button id="closeScan" class="btn small">Close</button></div><div class="video-wrap" style="margin-top:12px"><video id="scanVideo" playsinline muted></video><canvas id="scanCanvas" style="display:none"></canvas></div><button id="scanImageInstead" class="btn full" style="margin-top:12px">Import QR image instead</button></div>`;document.body.appendChild(back);
  const close=()=>{stopScanner();back.remove();};back.querySelector('#closeScan').onclick=close;back.querySelector('#scanImageInstead').onclick=()=>{close();qrImageInput.click();};
  navigator.mediaDevices?.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false}).then(stream=>{scanStream=stream;const v=back.querySelector('#scanVideo');v.srcObject=stream;v.play();const canvas=back.querySelector('#scanCanvas'),ctx=canvas.getContext('2d',{willReadFrequently:true});const tick=()=>{if(!document.body.contains(back))return;if(v.readyState>=2){canvas.width=v.videoWidth;canvas.height=v.videoHeight;ctx.drawImage(v,0,0);const img=ctx.getImageData(0,0,canvas.width,canvas.height);const code=jsQR(img.data,img.width,img.height,{inversionAttempts:'dontInvert'});if(code){close();handleQR(code.data);return;}}scanTimer=setTimeout(tick,220);};tick();}).catch(()=>{toast('Camera access was unavailable. Use Import QR image.');});
}
function stopScanner(){if(scanTimer)clearTimeout(scanTimer);scanTimer=null;if(scanStream){scanStream.getTracks().forEach(t=>t.stop());scanStream=null;}}
qrImageInput.addEventListener('change',async()=>{const f=qrImageInput.files?.[0];if(!f)return;if(!window.jsQR){toast('QR scanner library is unavailable.');return;}try{const bmp=await createImageBitmap(f);const c=document.createElement('canvas');c.width=bmp.width;c.height=bmp.height;const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(bmp,0,0);const img=ctx.getImageData(0,0,c.width,c.height);const code=jsQR(img.data,img.width,img.height);if(!code)throw new Error('No QR');handleQR(code.data);}catch(e){toast('No readable NVQPlus QR was found in that image.');}finally{qrImageInput.value='';}});
function handleQR(text){
  let p;try{p=JSON.parse(text);}catch(e){return toast('That is not a valid NVQPlus QR.');}if(p.a!=='NVQPlus'||p.v!==1||!p.lid)return toast('That is not a valid NVQPlus QR.');
  if(state.role==='assessor'){
    let l=state.assessor.learners[p.lid];if(!l){const name=prompt('New learner QR. Enter the learner name to store on this assessor phone:');if(!name)return;l=state.assessor.learners[p.lid]={learnerId:p.lid,name:name.trim()||'Unnamed learner',optionalUnit:p.ou||'',records:{},signatures:{}};}if(p.ou)l.optionalUnit=p.ou;mergeSnapshot(l,p.u||{},true);state.assessor.selectedLearnerId=p.lid;saveState();view='units';toast('Learner progress received.');render();
  }else{
    const l=state.apprentice;if(p.lid!==l.learnerId)return toast('This QR belongs to a different learner device.');mergeSnapshot(l,p.u||{},false);if(p.ou)l.optionalUnit=p.ou;saveState();toast('Assessor update received.');render();
  }
}
function mergeSnapshot(learner,units,fromApprentice){
  for(const [uid,criteria] of Object.entries(units)){for(const [cid,incoming] of Object.entries(criteria)){const cs=criterionState(learner,uid,cid);cs.subItems=[...new Set([...(cs.subItems||[]),...(incoming.i||[])])];if(incoming.f)cs.fixed=true;if(incoming.s){if(fromApprentice){if(cs.status!=='assessed'&&cs.status!=='topup')cs.status=incoming.s;}else cs.status=incoming.s;}}}
}

async function downloadPDF(learner,unit){
  const sig=learner.signatures?.[unit.id];if(!sig)return toast('The apprentice must sign this unit before download.');if(!window.PDFLib)return toast('PDF library is unavailable.');
  toast('Building PDF…');
  try{
    const {PDFDocument,StandardFonts,rgb}=PDFLib;const pdf=await PDFDocument.create();const regular=await pdf.embedFont(StandardFonts.Helvetica),bold=await pdf.embedFont(StandardFonts.HelveticaBold);const pageSize=[595.28,841.89];let page,y;
    const addPage=()=>{page=pdf.addPage(pageSize);y=800;page.drawText('NVQPlus',{x:42,y,font:bold,size:18,color:rgb(.12,.1,0)});page.drawText(`6570-05 · Unit ${unit.id}`,{x:42,y:y-22,font:regular,size:9,color:rgb(.4,.4,.4)});y-=52;};
    const wrap=(text,font,size,max)=>{const words=String(text||'').replace(/\n/g,' \n ').split(/\s+/);const lines=[];let line='';for(const w of words){if(w==='\n'){lines.push(line);line='';continue;}const test=line?line+' '+w:w;if(font.widthOfTextAtSize(test,size)>max&&line){lines.push(line);line=w;}else line=test;}if(line)lines.push(line);return lines;};
    const write=(text,{size=10,b=false,gap=4,indent=0}={})=>{const f=b?bold:regular;const lines=wrap(text,f,size,510-indent);for(const line of lines){if(y<55)addPage();page.drawText(line,{x:42+indent,y,font:f,size,color:rgb(.1,.1,.1)});y-=size+gap;}return y;};
    addPage();write(unit.title,{size:17,b:true,gap:6});write(`Apprentice: ${learner.name}`,{size:11});write(`Generated: ${new Date().toLocaleString()}`,{size:9});write('Assessment criteria mapping',{size:14,b:true,gap:7});
    const r=ensureUnitRecord(learner,unit.id);
    for(const lo of unit.learningOutcomes){write(`Learning Outcome ${lo.id}`,{size:11,b:true,gap:5});write(lo.wording,{size:9,gap:3});for(const c of lo.criteria){const cs=r.criteria[c.id]||{status:'',subItems:[],fixed:false};const label=cs.status==='assessed'?'ASSESSED':cs.status==='evidence'?'EVIDENCE':cs.status==='topup'?'TOP-UP':'OUTSTANDING';write(`${c.id}  [${label}] ${c.wording}`,{size:8.3,gap:3,indent:6});if(c.subItems?.length&&cs.subItems?.length)write(`Recorded: ${cs.subItems.join(', ')}${cs.fixed?' · fixed requirement recorded':''}`,{size:7.7,gap:3,indent:14});}y-=5;}
    const items=(await dbAll()).filter(x=>x.learnerId===learner.learnerId&&x.unitId===unit.id).sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
    write('Evidence',{size:14,b:true,gap:7});if(!items.length)write('No local evidence files are stored on this device for this unit.',{size:9});
    let audioNo=0;
    for(const item of items){write(`${item.kind.toUpperCase()} · ${item.criteria.map(c=>'['+c.cid+']').join(' ')} · ${new Date(item.createdAt).toLocaleString()}`,{size:9,b:true,gap:4});
      if(item.kind==='written')write(item.text||'',{size:9,gap:4,indent:6});
      if(item.kind==='photo'&&item.blob){try{const bytes=await item.blob.arrayBuffer();let img;if((item.mimeType||item.blob.type||'').includes('png'))img=await pdf.embedPng(bytes);else img=await pdf.embedJpg(bytes);const maxW=470,maxH=430,scale=Math.min(maxW/img.width,maxH/img.height,1);const w=img.width*scale,h=img.height*scale;if(y-h<50)addPage();page.drawImage(img,{x:62,y:y-h,width:w,height:h});y-=h+12;}catch(e){write(`Photo file could not be rendered: ${item.name||'photo'}`,{size:8});}}
      if(item.kind==='audio'&&item.blob){audioNo++;const ext=(item.name&&item.name.includes('.'))?item.name.split('.').pop():'audio';const fname=`audio-${audioNo}.${safeName(ext)}`;try{await pdf.attach(await item.blob.arrayBuffer(),fname,{mimeType:item.mimeType||item.blob.type||'application/octet-stream',description:`NVQPlus audio evidence for Unit ${unit.id}`});write(`Audio attached inside this PDF as: ${fname}`,{size:8.5,indent:6});}catch(e){write(`Audio attachment could not be embedded: ${item.name||'audio'}`,{size:8});}}
      y-=6;
    }
    write('Apprentice declaration',{size:14,b:true,gap:7});write('I confirm that the evidence contained in this unit pack is my own work and accurately represents the work I have completed.',{size:9,gap:5});write(`Signed by: ${learner.name}`,{size:10,b:true});write(`Signed: ${new Date(sig.signedAt).toLocaleString()}`,{size:9});
    try{const png=await fetch(sig.dataUrl).then(r=>r.arrayBuffer());const simg=await pdf.embedPng(png);const scale=Math.min(250/simg.width,90/simg.height,1);if(y-simg.height*scale<40)addPage();page.drawImage(simg,{x:42,y:y-simg.height*scale,width:simg.width*scale,height:simg.height*scale});y-=simg.height*scale+10;}catch(e){}
    const bytes=await pdf.save();const blob=new Blob([bytes],{type:'application/pdf'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`${safeName(learner.name)}-Unit-${unit.id}-NVQPlus.pdf`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1000);toast('Unit PDF downloaded.');
  }catch(e){console.error(e);toast('The PDF could not be created.');}
}

function openDB(){return new Promise((resolve,reject)=>{const req=indexedDB.open(DB_NAME,1);req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains('evidence'))req.result.createObjectStore('evidence',{keyPath:'id'});};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
async function dbPut(item){const db=await openDB();return new Promise((res,rej)=>{const tx=db.transaction('evidence','readwrite');tx.objectStore('evidence').put(item);tx.oncomplete=()=>res();tx.onerror=()=>rej(tx.error);});}
async function dbAll(){const db=await openDB();return new Promise((res,rej)=>{const req=db.transaction('evidence','readonly').objectStore('evidence').getAll();req.onsuccess=()=>res(req.result||[]);req.onerror=()=>rej(req.error);});}

if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
render();
})();
