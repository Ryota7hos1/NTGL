const $=(s,r=document)=>r.querySelector(s);

const state={spares:false};

function view(){
  return `<h2>Spares &amp; end-of-life <span class="chip warn">proposed idea</span></h2><p class="lead">A concept: link a part's expiry to a supplier request. Entangl's public roadmap describes buying <i>services</i> through supplier bids (planned). Automatic parts buying is not something it describes.</p>
  <div class="card"><table><tr><th>Part</th><th>Equipment</th><th>Service life</th><th>Spares</th><th>Status</th></tr>
  <tr><td>VRLA jars BS-12 (40)</td><td>BS-A1</td><td>Ends in <b>62 days</b></td><td>0</td><td><span class="chip bad">Replace soon</span></td></tr>
  <tr><td>Fan kit F-210</td><td>CRAH-3</td><td>14 months</td><td>2</td><td><span class="chip ok">OK</span></td></tr></table>
   <div style="margin-top:12px"><button class="btn" id="rfp">Draft supplier request for BS-A1</button></div></div>
  ${state.spares?`<div class="card fade" style="margin-top:14px"><h3>Draft request · needs engineer approval before sending</h3>
   <p><b>Scope:</b> replace 40 VRLA jars on BS-A1 before end of service life. <b>Evidence:</b> <span class="chip">BAT-DS rev 2</span><span class="chip">SLD-101 rev C</span>. <b>Work procedure:</b> site MOP attached.</p>
   <table><tr><th>Illustrative bids</th><th>Included</th><th>Excluded</th><th>Lead time</th></tr>
   <tr><td>Supplier A</td><td>Jars, install, disposal</td><td>Load bank test</td><td>3 wks</td></tr>
   <tr><td>Supplier B</td><td>Jars, install</td><td>Disposal, test</td><td>2 wks</td></tr>
   <tr><td>Supplier C</td><td>Jars only</td><td>Install, disposal</td><td>5 days</td></tr></table>
   <p class="note">Numbers are made up to show the layout. Past delivery history would inform the next decision.</p>
   <button class="btn" id="send" disabled>Engineer approve &amp; send (not wired in demo)</button></div>`:''}`;
}

function render(){
  $('#app').innerHTML=view();
  const rfp=$('#rfp');if(rfp)rfp.onclick=()=>{state.spares=true;render()};
}
render();
