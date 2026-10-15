const $=(s,r=document)=>r.querySelector(s);
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const gbp=n=>'£'+n.toLocaleString('en-GB');
const when=iso=>new Date(iso).toLocaleString('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});

const state={parts:[],request:null,expanded:new Set(),actor:localStorageGet('actor')||'',error:''};

function localStorageGet(k){try{return localStorage.getItem(k)}catch{return null}}
function localStorageSet(k,v){try{localStorage.setItem(k,v)}catch{}}

async function api(method,path,body){
  const res=await fetch(path,{method,headers:{'content-type':'application/json'},body:body&&JSON.stringify(body)});
  if(res.status===204)return null;
  const data=await res.json();
  if(!res.ok)throw new Error(data.error||res.statusText);
  return data;
}

// Runs an API action and re-renders; errors are shown inline instead of thrown.
async function act(fn){
  state.error='';
  try{await fn()}catch(e){state.error=e.message}
  state.parts=await api('GET','/api/parts');
  render();
}

const STATUS={
  replace_soon:['bad','Replace soon'],
  expired:['bad','Past end of life'],
  due_spares_on_hand:['warn','Due · spares on hand'],
  ok:['ok','OK']
};
const life=p=>p.days_remaining<0?`Ended <b>${-p.days_remaining} days</b> ago`
  :p.days_remaining<=90?`Ends in <b>${p.days_remaining} days</b>`
  :`${Math.round(p.days_remaining/30.4)} months`;

const years=d=>d%365===0?`${d/365} years`:`${d} days`;

function partsList(){
  return `<div class="parts">${state.parts.map(p=>{
    const [cls,label]=STATUS[p.status];
    const needs=p.status==='replace_soon'||p.status==='expired';
    const open=state.expanded.has(p.id);
    const action=p.open_request?`<button class="btn ghost" data-open="${p.open_request.id}">View request (${p.open_request.status})</button>`
      :needs?`<button class="btn" data-draft="${p.id}">Draft supplier request</button>`:'';
    return `<div class="card part" data-part="${p.id}">
     <div class="part-head">
      <button class="toggle" aria-expanded="${open}"><span class="caret">▸</span><b>${esc(p.name)}</b> <span class="muted">× ${p.quantity}</span></button>
      <span class="chip ${cls}">${label}</span><span class="muted">${p.spares_on_hand} spares</span>
      <span class="part-action">${action}</span>
     </div>
     ${open?`<dl class="part-body fade">
      <div><dt>Equipment</dt><dd>${esc(p.equipment_id)}</dd></div>
      <div><dt>Service life</dt><dd>${life(p)}</dd></div>
      <div><dt>End of life</dt><dd>${p.end_of_life}</dd></div>
      <div><dt>Installed</dt><dd>${p.installed_on} · rated ${years(p.service_life_days)}</dd></div>
     </dl>`:''}
    </div>`;
  }).join('')}
  <p class="note">Status is computed by the server from install date, service life and spares on hand.</p></div>`;
}

function requestCard(r){
  const steps=['draft','sent','awarded'];
  const at=steps.indexOf(r.status);
  const names={draft:'Drafted',sent:'Approved & sent',awarded:'Awarded'};
  const pipe=r.status==='cancelled'?'<div class="pipe"><div><b>Cancelled</b>No further action</div></div>'
    :`<div class="pipe">${steps.map((s,i)=>`<div class="${i<=at?'done':i===at+1?'cur':''}"><b>${names[s]}</b>${i<=at?'Complete':i===at+1?'Next':'Waiting'}</div>`).join('')}</div>`;
  const bids=r.bids.length?`<table><tr><th>Bid</th><th>Included</th><th>Excluded</th><th>Lead time</th><th>Price</th><th></th></tr>
    ${r.bids.map(b=>`<tr><td>${esc(b.supplier)}</td><td>${esc(b.included)}</td><td>${esc(b.excluded)}</td><td>${b.lead_time_days} days</td><td>${gbp(b.price_gbp)}</td>
    <td>${b.awarded?'<span class="chip ok">Awarded</span>':r.status==='sent'?`<button class="btn ghost" data-award="${b.id}">Award</button>`:''}</td></tr>`).join('')}</table>
    <p class="note">Bids are simulated supplier responses; prices are illustrative.</p>`:'';
  const actions=r.status==='draft'?`<button class="btn" id="send">Engineer approve &amp; send</button>`:'';
  const cancel=r.status==='draft'||r.status==='sent'?`<button class="btn ghost" id="cancel">Cancel request</button>`:'';
  return `<div class="card fade" style="margin-top:14px"><h3>Supplier request #${r.id} · ${esc(r.part.name)} on ${esc(r.part.equipment_id)}</h3>${pipe}
   <p><b>Scope:</b> ${esc(r.scope)} <b>Evidence:</b> ${r.evidence.map(e=>`<span class="chip">${esc(e)}</span>`).join('')}</p>
   ${bids}<div class="row" style="margin:12px 0">${actions}${cancel}</div>
   <h3>Audit trail</h3><table>${r.audit.map(a=>`<tr><td>${when(a.at)}</td><td><b>${esc(a.action)}</b>${a.detail?` · ${esc(a.detail)}`:''}</td><td>${esc(a.actor)}</td></tr>`).join('')}</table></div>`;
}

function render(){
  $('#app').innerHTML=`<h2>Spares &amp; end-of-life <span class="chip warn">proposed idea</span></h2><p class="lead">A concept: link a part's expiry to a supplier request. Entangl's public roadmap describes buying <i>services</i> through supplier bids (planned). Automatic parts buying is not something it describes.</p>
  ${state.error?`<p class="chip bad">${esc(state.error)}</p>`:''}
  ${partsList()}${state.request?requestCard(state.request):''}`;

  const on=(s,f)=>{const el=$(s);if(el)el.onclick=f};
  const actor=()=>state.actor;
  // The whole box toggles its details, except clicks on its action button.
  document.querySelectorAll('[data-part]').forEach(c=>c.onclick=e=>{
    if(e.target.closest('.part-action'))return;
    const id=Number(c.dataset.part);state.expanded.has(id)?state.expanded.delete(id):state.expanded.add(id);render();
  });
  document.querySelectorAll('[data-draft]').forEach(b=>b.onclick=()=>act(async()=>{state.request=await api('POST',`/api/parts/${b.dataset.draft}/requests`,{actor:actor()})}));
  document.querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>act(async()=>{state.request=await api('GET',`/api/requests/${b.dataset.open}`)}));
  document.querySelectorAll('[data-award]').forEach(b=>b.onclick=()=>act(async()=>{state.request=await api('POST',`/api/requests/${state.request.id}/award`,{actor:actor(),bid_id:Number(b.dataset.award)})}));
  on('#send',()=>act(async()=>{state.request=await api('POST',`/api/requests/${state.request.id}/send`,{actor:actor()})}));
  on('#cancel',()=>act(async()=>{state.request=await api('POST',`/api/requests/${state.request.id}/cancel`,{actor:actor()})}));
}

// Header controls live outside #app, so they are wired once and keep focus across re-renders.
$('#actor').value=state.actor;
$('#actor').oninput=e=>{state.actor=e.target.value;localStorageSet('actor',state.actor)};
$('#reset').onclick=()=>act(async()=>{await api('POST','/api/demo/reset');state.request=null});
act(async()=>{});
