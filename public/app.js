const $=(s,r=document)=>r.querySelector(s);
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const gbp=n=>'£'+n.toLocaleString('en-GB');
const when=iso=>new Date(iso).toLocaleString('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});

const state={parts:[],request:null,view:'list',quoteId:null,expanded:new Set(),actor:localStorageGet('actor')||'',error:''};

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
    const open=state.expanded.has(p.id);
    // Every part can be ordered.
    const last=p.last_order?.status==='ordered'?`<button class="btn ghost" data-open="${p.last_order.id}">View order</button>`
      :p.last_order?'<span class="chip ok">Already purchased</span>':'';
    const order=p.open_request?`<button class="btn" data-open="${p.open_request.id}">View request</button>`
      :`<button class="btn" data-draft="${p.id}">Get supplier quotes</button>`;
    const action=`<span class="row">${last}${order}</span>`;
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

const auditTrail=r=>`<h3 style="margin-top:16px">Audit trail</h3><table>${r.audit.map(a=>`<tr><td>${when(a.at)}</td><td><b>${esc(a.action)}</b>${a.detail?` · ${esc(a.detail)}`:''}</td><td>${esc(a.actor)}</td></tr>`).join('')}</table>`;
const arrival=(date,r)=>date<=r.part.end_of_life?'<span class="chip ok">Before end of life</span>':'<span class="chip bad">After end of life</span>';

// Unit price against what the part last cost, e.g. "+£15 vs last".
const priceChange=x=>x.change_vs_last_gbp===null?'':x.change_vs_last_gbp===0?'<br><span class="delta">same as last</span>'
  :`<br><span class="delta ${x.change_vs_last_gbp>0?'up':'down'}">${x.change_vs_last_gbp>0?'+':'−'}${gbp(Math.abs(x.change_vs_last_gbp))} vs last</span>`;

// Supplier quotes for a part, each with a route to the order screen.
function suppliersCard(r){
  const cheapest=Math.min(...r.quotes.map(x=>x.total_gbp));
  return `<div class="card fade" id="request" style="margin-top:14px">
   <div class="row"><h3 style="margin:0">Available suppliers · ${esc(r.part.name)} × ${r.part.quantity}</h3>
    <span style="margin-left:auto" class="row"><button class="btn ghost" id="purchased">Already purchased</button><button class="btn ghost" id="cancel">Cancel request</button></span></div>
   <p class="muted">${esc(r.scope)} End of life ${r.part.end_of_life}. Evidence: ${r.evidence.map(e=>`<span class="chip">${esc(e)}</span>`).join('')}</p>
   ${r.last_purchase?`<div class="last-buy">Last obtained <b>${gbp(r.last_purchase.unit_price_gbp)} each</b> from <b>${esc(r.last_purchase.supplier)}</b> on ${r.last_purchase.purchased_on} (${r.last_purchase.quantity} units)</div>`:''}
   <div class="quotes">${r.quotes.map(x=>`<div class="quote">
     <div><b>${esc(x.supplier)}</b>${x.previous_supplier?' <span class="chip warn">Previous supplier</span>':''}${x.total_gbp===cheapest?' <span class="chip">Lowest price</span>':''}<br><span class="muted">Includes ${esc(x.included.toLowerCase())} · excludes ${esc(x.excluded.toLowerCase())}</span></div>
     <div><span class="muted">Delivery</span><br>${x.lead_time_days} days · ${x.expected_delivery}<br>${arrival(x.expected_delivery,r)}</div>
     <div class="price"><span class="muted">${gbp(x.unit_price_gbp)} each</span>${priceChange(x)}<br><b>${gbp(x.total_gbp)}</b></div>
     <button class="btn" data-order="${x.id}">Order →</button>
   </div>`).join('')}</div>
   <p class="note">Suppliers and prices are fictional, generated for the demo.</p>
   ${auditTrail(r)}</div>`;
}

function orderView(r,x){
  return `<button class="btn ghost" id="back">← Back to suppliers</button>
  <h2 style="margin-top:14px">Place order</h2><p class="lead">${esc(r.scope)}</p>
  <div class="grid g2">
   <div class="card"><h3>Order summary</h3><table>
    <tr><td class="muted">Supplier</td><td><b>${esc(x.supplier)}</b></td></tr>
    <tr><td class="muted">Part</td><td>${esc(r.part.name)} for ${esc(r.part.equipment_id)}</td></tr>
    <tr><td class="muted">Quantity</td><td>${x.quantity} × ${gbp(x.unit_price_gbp)}</td></tr>
    <tr><td class="muted">Includes</td><td>${esc(x.included)}</td></tr>
    <tr><td class="muted">Excludes</td><td>${esc(x.excluded)}</td></tr>
    <tr><td class="muted">Expected delivery</td><td>${x.expected_delivery} ${arrival(x.expected_delivery,r)}</td></tr>
    <tr><td class="muted">Total</td><td class="kpi">${gbp(x.total_gbp)}</td></tr></table></div>
   <div class="card"><h3>Delivery details</h3>
    <form id="orderForm" class="form">
     <label>Delivery site<input name="delivery_site" value="Demo Site LHR-1, Hall A"></label>
     <label><span>PO reference <span class="muted">(optional)</span></span><input name="po_reference" placeholder="e.g. PO-2026-0412"></label>
     <label><span>Notes for supplier <span class="muted">(optional)</span></span><textarea name="notes" rows="3" placeholder="Access times, site induction, contact"></textarea></label>
     <p class="muted">Ordering as <b>${esc(state.actor||'(enter your name, top right)')}</b>. The order is recorded in the audit trail.</p>
     <button class="btn" type="submit">Place order · ${gbp(x.total_gbp)}</button>
    </form>
    <p class="note">Demo only: no order is sent to a real supplier.</p></div>
  </div>`;
}

function confirmationView(r){
  const o=r.order,x=r.quotes.find(q=>q.id===o.quote_id);
  return `<button class="btn ghost" id="home">← Back to parts</button>
  <div class="card fade" style="margin-top:14px"><h2><span class="chip ok">Order placed</span> Order #${o.id}</h2>
   <table>
    <tr><td class="muted">Supplier</td><td><b>${esc(x.supplier)}</b></td></tr>
    <tr><td class="muted">Part</td><td>${o.quantity} × ${esc(r.part.name)} for ${esc(r.part.equipment_id)}</td></tr>
    <tr><td class="muted">Total</td><td><b>${gbp(o.total_gbp)}</b></td></tr>
    <tr><td class="muted">Expected delivery</td><td>${o.expected_delivery} ${arrival(o.expected_delivery,r)}</td></tr>
    <tr><td class="muted">Delivery site</td><td>${esc(o.delivery_site)}</td></tr>
    ${o.po_reference?`<tr><td class="muted">PO reference</td><td>${esc(o.po_reference)}</td></tr>`:''}
    ${o.notes?`<tr><td class="muted">Notes</td><td>${esc(o.notes)}</td></tr>`:''}
    <tr><td class="muted">Placed by</td><td>${esc(o.placed_by)} · ${when(o.placed_at)}</td></tr>
   </table>${auditTrail(r)}</div>`;
}

function show(view,patch={}){Object.assign(state,{view},patch);render();scrollTo(0,0)}

function render(){
  const r=state.request;
  const error=state.error?`<p class="chip bad">${esc(state.error)}</p>`:'';
  if(state.view==='order'&&r)$('#app').innerHTML=error+orderView(r,r.quotes.find(x=>x.id===state.quoteId));
  else if(state.view==='placed'&&r?.order)$('#app').innerHTML=confirmationView(r);
  else $('#app').innerHTML=`<h2>Spares &amp; end-of-life <span class="chip warn">proposed idea</span></h2><p class="lead">A concept: link a part's expiry to a supplier request. Entangl's public roadmap describes buying <i>services</i> through supplier bids (planned). Automatic parts buying is not something it describes.</p>
  ${error}${partsList()}${r?.status==='open'?suppliersCard(r):''}`;

  const on=(s,f)=>{const el=$(s);if(el)el.onclick=f};
  const actor=()=>state.actor;
  // The whole box toggles its details, except clicks on its action button.
  document.querySelectorAll('[data-part]').forEach(c=>c.onclick=e=>{
    if(e.target.closest('.part-action'))return;
    const id=Number(c.dataset.part);state.expanded.has(id)?state.expanded.delete(id):state.expanded.add(id);render();
  });
  const openRequest=async req=>{state.request=req;state.view=req.status==='ordered'?'placed':'list'};
  document.querySelectorAll('[data-draft]').forEach(b=>b.onclick=()=>act(async()=>openRequest(await api('POST',`/api/parts/${b.dataset.draft}/requests`,{actor:actor()}))));
  document.querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>act(async()=>openRequest(await api('GET',`/api/requests/${b.dataset.open}`))));
  document.querySelectorAll('[data-order]').forEach(b=>b.onclick=()=>show('order',{quoteId:Number(b.dataset.order),error:''}));
  on('#back',()=>show('list',{error:''}));
  on('#home',()=>show('list',{request:null}));
  on('#purchased',()=>{if(confirm('Mark this part as already purchased? The request closes and no order can be placed.'))act(async()=>{await api('POST',`/api/requests/${state.request.id}/already-purchased`,{actor:actor()});state.request=null})});
  on('#cancel',()=>act(async()=>{state.request=await api('POST',`/api/requests/${state.request.id}/cancel`,{actor:actor()})}));
  const form=$('#orderForm');
  if(form)form.onsubmit=e=>{e.preventDefault();const f=Object.fromEntries(new FormData(form));
    act(async()=>{state.request=await api('POST',`/api/requests/${r.id}/orders`,{...f,actor:actor(),quote_id:state.quoteId});state.view='placed';scrollTo(0,0)})};
}

// Header controls live outside #app, so they are wired once and keep focus across re-renders.
$('#actor').value=state.actor;
$('#actor').oninput=e=>{state.actor=e.target.value;localStorageSet('actor',state.actor)};
$('#reset').onclick=()=>act(async()=>{await api('POST','/api/demo/reset');state.request=null;state.view='list'});
act(async()=>{});
