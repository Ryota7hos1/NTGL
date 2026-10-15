const $=(s,r=document)=>r.querySelector(s);
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const gbp=n=>'£'+n.toLocaleString('en-GB');
const when=iso=>new Date(iso).toLocaleString('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});

const state={parts:[],equipment:[],orders:[],audit:[],request:null,view:'site',markQuoteId:null,markElsewhere:false,notice:'',expanded:new Set(),expandedEquip:new Set(),actor:localStorageGet('actor')||'',error:''};

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
  state.error='';state.notice='';state.noticeProcedure=null;
  try{await fn()}catch(e){state.error=e.message}
  [state.parts,state.equipment]=await Promise.all([api('GET','/api/parts'),api('GET','/api/equipment')]);
  if(state.view==='activity')[state.orders,state.audit]=await Promise.all([api('GET','/api/orders'),api('GET','/api/audit')]);
  render();
}

const STATUS={
  failed:['bad','Failed'],
  replace_soon:['bad','Replace soon'],
  expired:['bad','Past end of life'],
  due_spares_on_hand:['warn','Due · spares on hand'],
  replacement_ordered:['ok','Replacement ordered'],
  ok:['ok','OK']
};
const failedAgo=p=>p.days_remaining===0?'today':p.days_remaining===-1?'yesterday':`${-p.days_remaining} days ago`;
const life=p=>p.status==='failed'?`<b>Failed ${failedAgo(p)}</b>, ${p.days_short_of_rating} days before its rated end`:p.days_remaining<0?`Ended <b>${-p.days_remaining} days</b> ago`
  :p.days_remaining<=90?`Ends in <b>${p.days_remaining} days</b>`
  :`${Math.round(p.days_remaining/30.4)} months`;

// A part's status label; when the previous unit's lifespan is what made it due, that is the reason shown.
const partLabel=p=>p.due_reason==='previous_service_life'&&p.status!=='replacement_ordered'
  ?(p.days_until_previous_failure<0?'Due · past previous service life':'Due · approaching previous service life')
  :STATUS[p.status][1];
// "X days until it broke last time", from how long the previous unit lasted.
const lastTime=p=>p.days_until_previous_failure===null||p.status==='failed'?''
  :p.days_until_previous_failure>=0?`${p.days_until_previous_failure} days until it broke last time`
  :`${-p.days_until_previous_failure} days past when it broke last time`;

const years=d=>d%365===0?`${d/365} years`:`${d} days`;

// One part as an expandable box. `key` keeps the same part's open/closed state separate per section.
function partBox(p,key,showEquipment=false){
  const cls=STATUS[p.status][0],label=partLabel(p);
  const open=state.expanded.has(key);
  // Every part can be ordered.
  const last=p.last_order?.status==='ordered'?`<button class="btn ghost" data-nav="activity">View order</button>`
    :p.last_order?'<span class="chip ok">Already purchased</span>':'';
  const order=p.open_request?`<button class="btn" data-open="${p.open_request.id}">View request</button>`
    :`<button class="btn" data-draft="${p.id}">Get supplier quotes</button>`;
  return `<div class="card part" data-part="${key}">
   <div class="part-head">
    <button class="toggle" aria-expanded="${open}"><span class="caret">▸</span><b>${esc(p.name)}</b> <span class="muted">× ${p.quantity}${showEquipment?` · ${esc(p.equipment_id)}`:''}</span></button>
    <span class="chip ${cls}">${label}</span><span class="muted">${p.spares_on_hand} spares</span>
    <span class="part-action"><span class="row">${last}${order}</span></span>
   </div>
   ${open?`<dl class="part-body fade">
    <div><dt>Equipment</dt><dd>${esc(p.equipment_id)}</dd></div>
    <div><dt>Service life</dt><dd>${life(p)}${lastTime(p)?`<br><span class="${p.due_reason==='previous_service_life'?'warn-text':'muted'}">${lastTime(p)}</span><br><span class="muted">Last unit lasted ${p.previous_lifespan_days} days</span>`:''}${p.status!=='failed'&&p.previous_supplier_lead_days?`<br><span class="muted">${p.previous_supplier?esc(p.previous_supplier):'Previous supplier'} delivers in ${p.previous_supplier_lead_days} days</span>`:''}</dd></div>
    <div><dt>End of life</dt><dd>${p.status==='failed'?`${p.end_of_life} <span class="chip bad">Failed</span><br><span class="muted">Rated ${p.rated_end_of_life}</span>`:p.end_of_life}</dd></div>
    <div><dt>Installed</dt><dd>${p.installed_on} · rated ${years(p.service_life_days)}</dd></div>
   </dl>`:''}
  </div>`;
}

const URGENCY={failed:-1,expired:0,replace_soon:1,due_spares_on_hand:2,replacement_ordered:3,ok:4};

// Parts that are red or yellow pinned on top, then every machine with its parts in a dropdown.
function equipmentList(){
  const attention=state.parts.filter(p=>URGENCY[p.status]<=URGENCY.due_spares_on_hand).sort((a,b)=>URGENCY[a.status]-URGENCY[b.status]||a.days_remaining-b.days_remaining);
  const machines=state.equipment.map(e=>{
    const [cls,label]=STATUS[e.status];
    const open=state.expandedEquip.has(e.id);
    const parts=state.parts.filter(p=>p.equipment_id===e.id);
    return `<div class="card part equip" data-equip-toggle="${esc(e.id)}">
     <div class="part-head">
      <button class="toggle" aria-expanded="${open}"><span class="caret">▸</span><b>${esc(e.name)}</b> <span class="muted">${esc(e.id)} · ${esc(e.location)}</span></button>
      <span class="chip ${cls}">${label}</span>
      <span class="muted" style="margin-left:auto">${parts.length} part${parts.length===1?'':'s'}</span>
     </div>
     ${open?`<div class="equip-body fade">${parts.map(p=>partBox(p,`eq:${p.id}`)).join('')}</div>`:''}
    </div>`;
  }).join('');
  return `<h3 class="section">Needs attention <span class="muted">${attention.length}</span></h3>
  ${attention.length?`<div class="parts">${attention.map(p=>partBox(p,`attn:${p.id}`,true)).join('')}</div>`:'<p class="muted">No parts are due.</p>'}
  <h3 class="section">All equipment <span class="muted">${state.equipment.length}</span></h3>
  <div class="parts">${machines}</div>
  <p class="note">Status is computed by the server. A part is due within 90 days of its rated end of life, or when the previous supplier's delivery would land within 30 days of its rated end of life or of the age the last unit failed at.</p>`;
}

// A failed part is already past its end of life, so any delivery is a replacement for a dead part.
const arrival=(date,r)=>r.part.status==='failed'?'<span class="chip bad">Part has failed</span>':date<=r.part.end_of_life?'<span class="chip ok">Before end of life</span>':'<span class="chip bad">After end of life</span>';

// Unit price against what the part last cost, e.g. "+£15 vs last".
const priceChange=x=>x.change_vs_last_gbp===null?'':x.change_vs_last_gbp===0?'<br><span class="delta">same as last</span>'
  :`<br><span class="delta ${x.change_vs_last_gbp>0?'up':'down'}">${x.change_vs_last_gbp>0?'+':'−'}${gbp(Math.abs(x.change_vs_last_gbp))} vs last</span>`;

// Supplier quotes for a part, each with a route to the order screen.
function suppliersPage(r){
  const rec=r.recommendation;
  const cheapest=Math.min(...r.quotes.map(x=>x.total_gbp));
  // Same list as before the engine, just in the engine's order.
  const rankOf=id=>rec.ranked.find(x=>x.quote_id===id);
  const ordered=[...r.quotes].sort((a,b)=>rankOf(a.id).rank-rankOf(b.id).rank);
  return `<button class="btn ghost" id="toEquipment">← Back to equipment</button>
  <div class="row" style="margin-top:14px"><h2 style="margin:0">Suppliers</h2>
   <span style="margin-left:auto" class="row"><button class="btn ghost" id="purchased">Already purchased</button><button class="btn ghost" id="cancel">Cancel request</button></span></div>
  <p class="lead">${esc(r.part.name)} × ${r.part.quantity} for ${esc(r.part.equipment_id)}</p>
  ${state.markElsewhere?boughtElsewhereForm(r):''}
  <div class="card fade" id="request">
   <p class="muted">${esc(r.scope)} ${r.part.status==='failed'?`Failed on ${r.part.end_of_life} (rated to ${r.part.rated_end_of_life}).`:`End of life ${r.part.end_of_life}.`} ${r.evidence.length?`Evidence: ${r.evidence.map(e=>`<span class="chip">${esc(e)}</span>`).join('')}`:''}</p>
   <a href="#" class="proc-link" data-procedure="${r.id}">Replacement procedure ${mopId(r.id)} · draft →</a>
   ${r.last_purchase?`<div class="last-buy">Last obtained <b>${gbp(r.last_purchase.unit_price_gbp)} each</b> from <b>${esc(r.last_purchase.supplier)}</b> on ${r.last_purchase.purchased_on} (${r.last_purchase.quantity} units)</div>`:''}
   <div class="quotes">${ordered.map(x=>`<div class="quote">
     <div><b>${esc(x.supplier)}</b>${x.previous_supplier?' <span class="chip warn">Previous supplier</span>':''}${x.total_gbp===cheapest?' <span class="chip">Lowest price</span>':''}<br><span class="muted">Includes ${esc(x.included.toLowerCase())} · excludes ${esc(x.excluded.toLowerCase())}</span></div>
     <div><span class="muted">Delivery</span><br>${x.lead_time_days} days · ${x.expected_delivery}<br>${arrival(x.expected_delivery,r)}</div>
     <div class="price"><span class="muted">${gbp(x.unit_price_gbp)} each</span>${priceChange(x)}<br><b>${gbp(x.total_gbp)}</b></div>
     <div class="quote-actions"><a class="btn" href="${esc(x.supplier_url)}" target="_blank" rel="noopener noreferrer">Go to supplier ↗</a><button class="btn ghost" data-mark="${x.id}">Mark as ordered</button></div>
   </div>${state.markQuoteId===x.id?markOrderedForm(x):''}`).join('')}</div>
   <p class="note">Suppliers and prices are fictional, generated for the demo. "Go to supplier" opens a placeholder page.</p>
   </div>`;
}

// Buying happens on the supplier's site; this records the order so the part, history and log stay current.
// Same pattern as recording an order, for a part that was bought outside these quotes.
function boughtElsewhereForm(r){
  const today=new Date().toISOString().slice(0,10);
  return `<form class="mark-form form fade" id="elsewhereForm">
   <p style="margin:0">Already bought <b>${esc(r.part.name)} × ${r.part.quantity}</b> somewhere else? Record it here so the part stops needing attention.</p>
   <div class="row">
    <label><span>Supplier</span><input name="supplier" list="supplierNames" placeholder="Who it was bought from" required></label>
    <datalist id="supplierNames">${[...new Set([r.last_purchase?.supplier,...r.quotes.map(x=>x.supplier)].filter(Boolean))].map(n=>`<option value="${esc(n)}">`).join('')}</datalist>
    <label><span>Total paid <span class="muted">(optional, £)</span></span><input name="total_gbp" type="number" min="1" step="1" placeholder="e.g. 6800"></label>
   </div>
   <div class="row">
    <label><span>PO reference <span class="muted">(optional)</span></span><input name="po_reference" placeholder="e.g. PO-2026-0412"></label>
    <label><span>Delivery date <span class="muted">(expected or received)</span></span><input type="date" name="expected_delivery" value="${today}" required></label>
   </div>
   <div class="row"><button class="btn" type="submit">Record purchase</button><button class="btn ghost" type="button" id="elsewhereCancel">Cancel</button>
    <span class="muted">Recorded as ${esc(state.actor||'(enter your name, top right)')}</span></div>
  </form>`;
}

function markOrderedForm(x){
  const today=new Date().toISOString().slice(0,10);
  return `<form class="mark-form form fade" id="markForm">
   <p style="margin:0">Ordered from <b>${esc(x.supplier)}</b> on their site? Record it here so the part stops needing attention.</p>
   <div class="row">
    <label><span>PO reference <span class="muted">(optional)</span></span><input name="po_reference" placeholder="e.g. PO-2026-0412"></label>
    <label><span>Expected delivery</span><input type="date" name="expected_delivery" value="${x.expected_delivery}" min="${today}" required></label>
   </div>
   <div class="row"><button class="btn" type="submit">Record order · ${gbp(x.total_gbp)}</button><button class="btn ghost" type="button" id="markCancel">Cancel</button>
    <span class="muted">Recorded as ${esc(state.actor||'(enter your name, top right)')}</span></div>
  </form>`;
}

// Every order and every logged action, across all parts.
function activityView(){
  const orders=state.orders.length?`<div class="scroll"><table><tr><th>Date</th><th>Part</th><th>Qty</th><th>Supplier</th><th>Total</th><th>Delivery</th><th>PO</th><th>By</th><th>Procedure</th></tr>
   ${state.orders.map(o=>`<tr><td class="nowrap">${when(o.at)}</td><td class="nowrap"><b>${esc(o.part)}</b><br><span class="muted">${esc(o.equipment_id)}</span></td><td>${o.quantity}</td>
    <td>${esc(o.supplier)}${o.source==='purchased_elsewhere'?' <span class="chip ok">Bought elsewhere</span>':''}</td>
    <td>${o.total_gbp===null?'—':gbp(o.total_gbp)}</td><td class="nowrap">${o.expected_delivery}</td><td class="nowrap">${esc(o.po_reference??'—')}</td>
    <td class="nowrap">${esc(o.actor)}</td><td class="nowrap"><a href="#" data-procedure="${o.request_id}">${esc(o.procedure_id)} →</a></td></tr>`).join('')}</table></div>`
    :'<p class="muted">No parts ordered yet.</p>';
  const log=state.audit.length?`<div class="scroll"><table><tr><th>When</th><th>Part</th><th>Action</th><th>By</th></tr>
   ${state.audit.map(a=>`<tr><td class="nowrap">${when(a.at)}</td><td>${esc(a.part)}<br><span class="muted">${esc(a.equipment_id)}</span></td><td><b>${esc(a.action)}</b>${a.detail?` · ${esc(a.detail)}`:''}</td><td class="nowrap">${esc(a.actor)}</td></tr>`).join('')}</table></div>`
    :'<p class="muted">Nothing logged yet.</p>';
  return `<h2>Orders &amp; activity</h2><p class="lead">Every part ordered and every action taken, newest first. Each entry records who did it and when.</p>
  <div class="card"><h3>Parts ordered</h3>${orders}</div>
  <div class="card" style="margin-top:14px"><h3>Activity log</h3>${log}</div>`;
}

const mopId=id=>`MOP-${String(id).padStart(3,'0')}`;

// Draft method of procedure for replacing the part: ordering is half the job, the work is the other half.
function procedureView(m){
  return `<button class="btn ghost" id="procBack">← Back</button>
  <div class="card fade proc" style="margin-top:14px">
   <span class="eyebrow">Method of procedure · ${m.id}</span>
   <div class="row" style="margin:4px 0 6px"><h2 style="margin:0">${esc(m.title)}</h2><span class="chip warn">Draft</span></div>
   <p class="muted" style="margin:0">${esc(m.equipment.name)} · ${esc(m.equipment.location)}${m.order?` · Parts from ${esc(m.order.supplier)}, expected ${m.order.expected_delivery}${m.order.po_reference?` (${esc(m.order.po_reference)})`:''}`:' · Not ordered yet'}</p>
   <p style="margin:12px 0 4px"><b>Site documents</b></p>
   <div>${m.documents.map(d=>`<span class="chip">${esc(d)}</span>`).join('')}</div>
   <p style="margin:14px 0 4px"><b>Steps</b></p>
   <ol class="proc-steps">${m.steps.map(st=>`<li class="${st.needs_input?'needs':''}"><div>${esc(st.text)}</div>
     ${st.evidence.length?`<div>${st.evidence.map(e=>`<span class="chip">${esc(e)}</span>`).join('')}</div>`:''}
     ${st.needs_input?`<div class="warn-text">Needs engineer input: ${esc(st.needs_input)}</div>`:''}</li>`).join('')}</ol>
   <p class="note">Outline drafted from the request. In Entangl, the procedure would be generated and reviewed against the site's drawings, equipment and operating rules, and approved by an engineer before any work starts.</p>
  </div>`;
}

function show(view,patch={}){Object.assign(state,{view},patch);render();scrollTo(0,0)}

// Tabs: 'site' and 'activity' load their own data; everything else belongs to the Equipment tab.
const tabOf=view=>view==='procedure'?tabOf(state.backTo?.view):view==='site'||view==='activity'?view:'equipment';

function navigate(page,patch={}){
  state.popup=null;
  if(page==='site'||page==='activity')act(async()=>{Object.assign(state,{view:page,request:null},patch)});
  else show('list',{request:null,...patch});
  scrollTo(0,0);
}

const lifeText=p=>p.status==='failed'?`failed ${failedAgo(p)}, ${p.days_short_of_rating} days early`:p.days_remaining<0?`ended ${-p.days_remaining} days ago`:p.days_remaining<=90?`ends in ${p.days_remaining} days`:`${Math.round(p.days_remaining/30.4)} months left`;

function siteView(){
  return `<h2>Site</h2><p class="lead">Demo Site LHR-1, Hall A. Each tagged machine is listed in the Equipment tab; its dot shows the most urgent part inside it. Click a machine to see its parts.</p>
  <div class="site-hero" id="siteHero">${SITE.scene(state.equipment)}
   <div class="site-legend">${[['replace_soon','Part needs replacing'],['due_spares_on_hand','Due, spares on hand'],['ok','OK or replacement ordered']].map(([k,l])=>`<span><i style="background:${SITE.STATUS_DOT[k]}"></i>${l}</span>`).join('')}
    <span class="muted-light">Static illustration, not a live model</span></div></div>`;
}

// Popup with a machine's parts, placed next to where it was clicked inside the drawing.
function openMachinePopup(id,clientX,clientY,fromKeyboard=false){
  const e=state.equipment.find(x=>x.id===id),hero=$('#siteHero');
  if(!e||!hero)return;
  closeMachinePopup();
  state.popup={id,clientX,clientY};
  const [cls,label]=STATUS[e.status];
  const pop=document.createElement('div');
  pop.className='site-popup card fade';pop.setAttribute('role','dialog');pop.setAttribute('aria-label',e.name);
  // Equipment sits in a dark header band; each part inside it is its own bordered row below.
  pop.innerHTML=`<div class="pop-equip">
    <div class="row"><span class="eyebrow">Equipment</span><button class="popup-close" aria-label="Close">×</button></div>
    <div class="row"><h3>${esc(e.name)}</h3><span class="chip ${cls}" style="margin-left:auto">${label}</span></div>
    <p>${esc(e.id)} · ${esc(e.location)}</p>
   </div>
   <div class="pop-parts">
    <span class="eyebrow">Parts inside · ${e.parts.length}</span>
    <ul>${e.parts.map(p=>`<li class="pop-part ${STATUS[p.status][0]}">
      <div><span class="part-label">Part</span><b>${esc(p.name)}</b> <span class="muted">× ${p.quantity}</span><br><span class="muted">${lifeText(p)}</span>${lastTime(p)?`<br><span class="${p.due_reason==='previous_service_life'?'warn-text':'muted'}">${lastTime(p)}</span>`:''}</div>
      <span class="pop-part-side"><span class="chip ${STATUS[p.status][0]}">${partLabel(p)}</span>${p.status==='failed'?'':`<button class="btn-destroy" data-destroy="${p.id}" title="Demo: make this part fail">Destroy</button>`}</span>
     </li>`).join('')}</ul>
    <button class="btn" data-equip="${esc(e.id)}">Open in Equipment →</button>
    <p class="note" style="margin-bottom:0">Destroy is for the demo: it makes a part fail so the replacement flow can be shown.</p>
   </div>`;
  hero.appendChild(pop);
  const box=hero.getBoundingClientRect(),x=clientX-box.left,y=clientY-box.top;
  const w=pop.offsetWidth,h=pop.offsetHeight;
  pop.style.left=Math.max(8,Math.min(x-w/2,box.width-w-8))+'px';
  pop.style.top=(y+h+16<box.height?y+14:Math.max(8,y-h-14))+'px';
  pop.querySelector('.popup-close').onclick=closeMachinePopup;
  pop.querySelectorAll('[data-destroy]').forEach(b=>b.onclick=()=>act(async()=>{await api('POST',`/api/parts/${b.dataset.destroy}/destroy`,{actor:state.actor})}));
  pop.querySelector('[data-equip]').onclick=()=>navigate('equipment',{expandedEquip:new Set([id])});
  if(fromKeyboard)pop.querySelector('[data-equip]').focus({preventScroll:true});
}
function closeMachinePopup(){state.popup=null;document.querySelector('.site-popup')?.remove()}

function render(){
  document.querySelectorAll('.tabs [data-nav]').forEach(a=>a.classList.toggle('on',a.dataset.nav===tabOf(state.view)));
  const r=state.request;
  const error=state.error?`<p class="chip bad">${esc(state.error)}</p>`:'';
  const notice=state.notice?`<p class="notice fade">${esc(state.notice)} <a href="#" data-nav="activity">See orders</a>${state.noticeProcedure?` · <a href="#" data-procedure="${state.noticeProcedure}">Replacement procedure ${mopId(state.noticeProcedure)}</a>`:''}</p>`:'';
  if(state.view==='procedure'&&state.procedure)$('#app').innerHTML=error+procedureView(state.procedure);
  else if(state.view==='activity')$('#app').innerHTML=error+activityView();
  else if(state.view==='site')$('#app').innerHTML=error+siteView();
  else if(state.view==='suppliers'&&r?.status==='open')$('#app').innerHTML=error+suppliersPage(r);
  else $('#app').innerHTML=`<h2>Equipment <span class="chip warn">proposed idea</span></h2><p class="lead">Every machine on site and the parts inside it, with ordering linked to each part's end of life. Entangl's public roadmap describes buying <i>services</i> through supplier bids (planned). Automatic parts buying is not something it describes.</p>
  ${error}${notice}${equipmentList()}`;

  const on=(s,f)=>{const el=$(s);if(el)el.onclick=f};
  const actor=()=>state.actor;
  // The whole box toggles its details, except clicks on its action button.
  const toggle=(set,key)=>{set.has(key)?set.delete(key):set.add(key);render()};
  document.querySelectorAll('[data-part]').forEach(c=>c.onclick=e=>{
    e.stopPropagation();
    if(!e.target.closest('.part-action'))toggle(state.expanded,c.dataset.part);
  });
  document.querySelectorAll('[data-equip-toggle]').forEach(c=>c.onclick=()=>toggle(state.expandedEquip,c.dataset.equipToggle));
  // Getting quotes or viewing a request opens the Suppliers page; an ordered one shows in the orders list.
  const openRequest=async req=>{state.request=req;state.view=req.status==='ordered'?'activity':'suppliers';state.markQuoteId=null;state.markElsewhere=false;scrollTo(0,0)};
  document.querySelectorAll('[data-draft]').forEach(b=>b.onclick=()=>act(async()=>openRequest(await api('POST',`/api/parts/${b.dataset.draft}/requests`,{actor:actor()}))));
  document.querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>act(async()=>openRequest(await api('GET',`/api/requests/${b.dataset.open}`))));
  document.querySelectorAll('[data-mark]').forEach(b=>b.onclick=()=>{Object.assign(state,{markQuoteId:Number(b.dataset.mark),markElsewhere:false,error:''});render();$('#markForm input')?.focus()});
  on('#markCancel',()=>{state.markQuoteId=null;render()});
  document.querySelectorAll('[data-procedure]').forEach(a=>a.onclick=e=>{e.preventDefault();e.stopPropagation();
    const back={view:state.view,request:state.request};
    act(async()=>{state.procedure=await api('GET',`/api/requests/${a.dataset.procedure}/procedure`);Object.assign(state,{backTo:back,view:'procedure'});scrollTo(0,0)})});
  on('#procBack',()=>act(async()=>{Object.assign(state,state.backTo??{view:'list'},{procedure:null})}));
  on('#toEquipment',()=>show('list',{request:null,error:''}));
  document.querySelectorAll('#app [data-nav]').forEach(a=>a.onclick=e=>{e.preventDefault();e.stopPropagation();navigate(a.dataset.nav)});
  // Site drawing: clicking a machine opens its popup.
  const hero=$('#siteHero');
  if(hero&&state.popup){const {id,clientX,clientY}=state.popup;openMachinePopup(id,clientX,clientY)}
  if(hero){
    hero.onclick=e=>{
      if(e.target.closest('.site-popup'))return;
      const m=e.target.closest('[data-machine]');
      m?openMachinePopup(m.dataset.machine,e.clientX,e.clientY):closeMachinePopup();
    };
    hero.onkeydown=e=>{
      const m=e.target.closest('[data-machine]');
      if(m&&(e.key==='Enter'||e.key===' ')){e.preventDefault();const r=m.getBoundingClientRect();openMachinePopup(m.dataset.machine,r.left+r.width/2,r.bottom,true)}
    };
  }
  on('#purchased',()=>{Object.assign(state,{markElsewhere:!state.markElsewhere,markQuoteId:null,error:''});render();$('#elsewhereForm input')?.focus()});
  on('#elsewhereCancel',()=>{state.markElsewhere=false;render()});
  const elsewhere=$('#elsewhereForm');
  if(elsewhere)elsewhere.onsubmit=e=>{e.preventDefault();const f=Object.fromEntries(new FormData(elsewhere));
    act(async()=>{
      const done=await api('POST',`/api/requests/${r.id}/already-purchased`,{...f,actor:actor()});
      const o=done.order;
      Object.assign(state,{request:null,view:'list',markElsewhere:false,notice:`Recorded as already purchased: ${o.supplier}${o.total_gbp?`, ${gbp(o.total_gbp)}`:''}, ${done.part.name} delivery ${o.expected_delivery}.`});
      scrollTo(0,0);
    })};
  on('#cancel',()=>act(async()=>{await api('POST',`/api/requests/${state.request.id}/cancel`,{actor:actor()});state.request=null;state.view='list'}));
  const form=$('#markForm');
  if(form)form.onsubmit=e=>{e.preventDefault();const f=Object.fromEntries(new FormData(form));
    act(async()=>{
      const done=await api('POST',`/api/requests/${r.id}/orders`,{...f,actor:actor(),quote_id:state.markQuoteId});
      const x=done.quotes.find(q=>q.id===done.order.quote_id);
      Object.assign(state,{request:null,view:'list',markQuoteId:null,noticeProcedure:done.id,notice:`Order recorded: ${x.supplier}, ${gbp(done.order.total_gbp)}, ${done.part.name} due ${done.order.expected_delivery}.`});
      scrollTo(0,0);
    })};
}

// Header controls live outside #app, so they are wired once and keep focus across re-renders.
$('#actor').value=state.actor;
$('#actor').oninput=e=>{state.actor=e.target.value;localStorageSet('actor',state.actor)};
$('#reset').onclick=()=>act(async()=>{await api('POST','/api/demo/reset');state.request=null;if(tabOf(state.view)==='equipment')state.view='list'});
document.querySelectorAll('.tabs [data-nav]').forEach(a=>a.onclick=()=>navigate(a.dataset.nav));
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeMachinePopup()});
act(async()=>{});
