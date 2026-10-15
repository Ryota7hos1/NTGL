const $=(s,r=document)=>r.querySelector(s);
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

// ---------- fictional site data ----------
const DOCS={
 'SLD-101':{title:'Single-line diagram, Hall A power',rev:'C',note:'Current site record'},
 'MAN-UPSX':{title:'UPS-X 800 manufacturer manual',rev:'4',note:'Vendor'},
 'SHIFT-0930':{title:'Shift lead change note, 30 Sep',rev:'1',note:'Breaker CB-A2 relabelled CB-A3'},
 'OPS-RULES':{title:'Site operating rules: LOTO and two-person work',rev:'7',note:'Site rules'},
 'BAT-DS':{title:'VRLA battery datasheet BS-12',rev:'2',note:'Vendor'}
};
const EQUIP=[
 {id:'UPS-A',name:'UPS A (800 kVA)',docs:['SLD-101','MAN-UPSX','OPS-RULES','SHIFT-0930']},
 {id:'BS-A1',name:'Battery string A1',docs:['SLD-101','BAT-DS','OPS-RULES']},
 {id:'GEN-1',name:'Generator 1',docs:['SLD-101','OPS-RULES']},
 {id:'ATS-1',name:'Transfer switch 1',docs:['SLD-101','OPS-RULES']},
 {id:'CRAH-3',name:'CRAH unit 3',docs:['OPS-RULES']}
];
const state={tab:'model',equip:'UPS-A',type:'MOP',generated:false,findings:[],stage:0,spares:false,tel:false};

const STEPS=[
 {t:'Confirm work window and notify the shift lead.',ev:['OPS-RULES']},
 {t:'Verify UPS A is on normal inverter and load is below 70%.',ev:['MAN-UPSX']},
 {t:'Identify the upstream breaker on drawing revision B and confirm its position.',ev:['SLD-101 rev B'],flag:'rev'},
 {t:'Apply lockout/tagout under the two-person rule.',ev:['OPS-RULES']},
 {t:'Open breaker CB-A2 to isolate the battery cabinet.',ev:['SHIFT-0930'],flag:'label'},
 {t:'Torque battery terminal connections to the specified value.',ev:[],flag:'gap'},
 {t:'Record string voltage and photograph each jar. Capture readings on the iPad.',ev:['BAT-DS']},
 {t:'Restore, remove LOTO, confirm UPS A returns to normal state, sign off.',ev:['MAN-UPSX']}
];
const FINDINGS=[
 {id:'rev',step:3,sev:'warn',title:'Drawing revision mismatch',body:'Step cites SLD-101 revision B. The site record is revision C.',opts:['Update citation to rev C','Keep rev B (explain)','Dismiss']},
 {id:'label',step:5,sev:'warn',title:'Equipment label changed',body:'Shift note of 30 Sep says breaker CB-A2 was relabelled CB-A3.',opts:['Use CB-A3','Keep CB-A2','Dismiss']},
 {id:'gap',step:6,sev:'bad',title:'Evidence gap',body:'No torque specification found in the site records for these terminals. The system will not invent one.',opts:['Engineer enters value from datasheet','Mark as site-verified in field','Dismiss']}
];

// ---------- views ----------
const views={
model(){
  const e=EQUIP.find(x=>x.id===state.equip);
  return `<h2>Site model</h2><p class="lead">Documents, drawings and equipment records linked into one model of the site. Demo Site LHR-1, Hall A.</p>
  <div class="grid g2"><div class="card"><h3>Equipment</h3><table>${EQUIP.map(x=>`<tr class="click ${x.id===state.equip?'sel':''}" data-eq="${x.id}"><td><b>${x.id}</b><br><span class="muted">${x.name}</span></td><td>${x.docs.length} linked docs</td></tr>`).join('')}</table></div>
  <div class="card"><h3>${e.id} · linked evidence</h3><table><tr><th>Document</th><th>Rev</th></tr>${e.docs.map(d=>`<tr><td>${d}<br><span class="muted">${DOCS[d].title}</span></td><td><span class="chip">${DOCS[d].rev}</span></td></tr>`).join('')}</table>
  <p class="note">The model is what procedures are written and checked against. Selecting equipment here sets the target for the next step.</p>
  <button class="btn" id="goWrite">Write a procedure for ${e.id} →</button></div></div>`;
},
write(){
  const e=EQUIP.find(x=>x.id===state.equip);
  const body=state.generated?`<div class="card fade"><h3>${state.type} · ${e.id} quarterly inspection <span class="chip warn">DRAFT</span></h3>
   ${STEPS.map((s,i)=>`<div class="step ${s.flag==='gap'?'gap':s.flag?'flag':''}"><div class="num">${i+1}</div><div>${esc(s.t)}<br>${s.ev.length?s.ev.map(v=>`<span class="chip">${esc(v)}</span>`).join(''):'<span class="chip bad">no evidence found</span>'}</div></div>`).join('')}
   <p class="note">A generated draft does not authorise any work. Every step shows its source evidence.</p>
   <button class="btn" id="goReview">Send to review →</button></div>`:`<div class="card"><p class="muted">Choose a procedure type and generate a site-specific draft from the model.</p></div>`;
  return `<h2>Write procedures</h2><p class="lead">Site-specific MOPs, SOPs and EOPs drafted from the site model.</p>
  <div class="row" style="margin-bottom:14px"><label>Equipment <select id="eqSel">${EQUIP.map(x=>`<option ${x.id===state.equip?'selected':''}>${x.id}</option>`).join('')}</select></label>
  <label>Type <select id="typeSel">${[['MOP','MOP · planned maintenance'],['SOP','SOP · routine operation'],['EOP','EOP · emergency']].map(([v,l])=>`<option value="${v}" ${v===state.type?'selected':''}>${l}</option>`).join('')}</select></label>
  <button class="btn" id="gen">Generate draft</button></div>${body}`;
},
review(){
  if(!state.generated)return `<h2>Review &amp; approve</h2><div class="card"><p class="muted">Generate a draft first (tab 2).</p></div>`;
  const open=state.findings.filter(f=>!f.done).length;
  const names=['Draft generated','Software review','Engineer review','Authorisation to proceed'];
  const pipe=names.map((n,i)=>`<div class="${i<state.stage?'done':i===state.stage?'cur':''}"><b>${n}</b>${i<state.stage?'Complete':i===state.stage?'Current':'Waiting'}</div>`).join('');
  return `<h2>Review &amp; approve</h2><p class="lead">Software review, engineer review and authorisation are three separate steps.</p><div class="pipe">${pipe}</div>
  <div class="grid g2"><div>${state.findings.map(f=>`<div class="finding ${f.done?'res':''}"><div class="row"><span class="chip ${f.sev}">Step ${f.step}</span><b>${f.title}</b></div><p>${f.body}</p>
   ${f.done?`<span class="chip ok">Resolved: ${esc(f.done)}</span>`:`<div class="row">${f.opts.map(o=>`<button class="btn ghost" data-f="${f.id}" data-o="${esc(o)}">${esc(o)}</button>`).join('')}</div>`}</div>`).join('')}</div>
  <div class="card"><h3>Approval</h3><p class="muted">${open} finding(s) open.</p>
   <div class="row"><button class="btn" id="a1" ${open||state.stage!==1?'disabled':''}>Engineer approves</button>
   <button class="btn" id="a2" ${state.stage!==2?'disabled':''}>Authoriser: proceed</button></div>
   ${state.stage===4?'<p class="fade"><span class="chip ok">Authorised</span> Audit trail recorded: who resolved what, who approved, when.</p>':''}
   <p class="note">The engineer makes the judgment calls. The tool checks and records.</p></div></div>`;
},
telemetry(){
  return `<h2>AI telemetry <span class="chip warn">explore scope</span></h2><p class="lead">Related alarms are grouped into one issue tied to the equipment, with the response procedure attached. It does not diagnose faults or control equipment.</p>
  <div class="grid g2"><div class="card"><h3>Raw alarms</h3><div id="alarms">${state.tel?['02:14:07 UPS-A  Battery voltage low','02:14:09 BS-A1  String temp high','02:14:11 UPS-A  On battery','02:14:20 ATS-1  Source 1 fail'].map(a=>`<div class="alarm">${a}</div>`).join(''):'<p class="muted">No alarms. Simulate an event to see grouping.</p>'}</div>
   <button class="btn" id="sim" style="margin-top:8px">Simulate alarm burst</button></div>
   <div class="card"><h3>Grouped issue</h3>${state.tel?`<div class="fade"><b>Issue #1 · Power event on UPS A path</b><br>4 alarms · equipment UPS-A, BS-A1, ATS-1<br><br>Suggested response procedure: <span class="chip">EOP-07 UPS on battery</span><br>Site rules: <span class="chip">OPS-RULES rev 7</span><p class="note">Shown for the on-shift engineer to act on. No root cause is claimed.</p></div>`:'<p class="muted">Waiting for alarms.</p>'}</div></div>`;
},
spares(){
  return `<h2>Spares &amp; end-of-life <span class="chip warn">proposed idea</span></h2><p class="lead">A concept: link a part's expiry to a supplier request. Entangl's public roadmap describes buying <i>services</i> through supplier bids (planned). Automatic parts buying is not something it describes.</p>
  <div class="card"><table><tr><th>Part</th><th>Equipment</th><th>Service life</th><th>Spares</th><th>Status</th></tr>
  <tr><td>VRLA jars BS-12 (40)</td><td>BS-A1</td><td>Ends in <b>62 days</b></td><td>0</td><td><span class="chip bad">Replace soon</span></td></tr>
  <tr><td>Fan kit F-210</td><td>CRAH-3</td><td>14 months</td><td>2</td><td><span class="chip ok">OK</span></td></tr></table>
   <div style="margin-top:12px"><button class="btn" id="rfp">Draft supplier request for BS-A1</button></div></div>
  ${state.spares?`<div class="card fade" style="margin-top:14px"><h3>Draft request · needs engineer approval before sending</h3>
   <p><b>Scope:</b> replace 40 VRLA jars on BS-A1 before end of service life. <b>Evidence:</b> <span class="chip">BAT-DS rev 2</span><span class="chip">SLD-101 rev C</span>. <b>Work procedure:</b> MOP generated in tab 2 attached.</p>
   <table><tr><th>Illustrative bids</th><th>Included</th><th>Excluded</th><th>Lead time</th></tr>
   <tr><td>Supplier A</td><td>Jars, install, disposal</td><td>Load bank test</td><td>3 wks</td></tr>
   <tr><td>Supplier B</td><td>Jars, install</td><td>Disposal, test</td><td>2 wks</td></tr>
   <tr><td>Supplier C</td><td>Jars only</td><td>Install, disposal</td><td>5 days</td></tr></table>
   <p class="note">Numbers are made up to show the layout. Past delivery history would inform the next decision.</p>
   <button class="btn" id="send" disabled>Engineer approve &amp; send (not wired in demo)</button></div>`:''}`;
}};

function render(){
  document.querySelectorAll('#nav button').forEach(b=>b.classList.toggle('on',b.dataset.tab===state.tab));
  $('#app').innerHTML=views[state.tab]();
  const on=(s,f)=>{const el=$(s);if(el)el.onclick=f};
  document.querySelectorAll('[data-eq]').forEach(r=>r.onclick=()=>{state.equip=r.dataset.eq;state.generated=false;render()});
  on('#goWrite',()=>{state.tab='write';render()});
  on('#goReview',()=>{state.tab='review';render()});
  on('#gen',()=>{state.type=$('#typeSel').value;state.equip=$('#eqSel').value;state.generated=true;state.findings=FINDINGS.map(f=>({...f}));state.stage=1;render()});
  document.querySelectorAll('[data-f]').forEach(b=>b.onclick=()=>{state.findings.find(f=>f.id===b.dataset.f).done=b.dataset.o;render()});
  on('#a1',()=>{state.stage=2;render()});
  on('#a2',()=>{state.stage=4;render()});
  on('#sim',()=>{state.tel=true;render()});
  on('#rfp',()=>{state.spares=true;render()});
}
$('#nav').onclick=e=>{const t=e.target.closest('button');if(t){state.tab=t.dataset.tab;render()}};
render();
