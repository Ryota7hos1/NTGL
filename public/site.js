// Static isometric drawing of the demo site, built as one SVG string.
// No 3D, animation or live model: it is drawn once per render and costs nothing to keep on screen.
// Machines carry data-machine so a click can open their parts popup.
const SITE=(()=>{
  const S=22,COS=Math.cos(Math.PI/6),SIN=0.5;
  const P=(x,y,z=0)=>[(x-y)*COS*S,(x+y)*SIN*S-z*S];
  const pts=a=>a.map(p=>p.map(n=>n.toFixed(1)).join(',')).join(' ');
  const shade=(hex,f)=>'#'+hex.slice(1).match(/../g).map(h=>Math.max(0,Math.min(255,Math.round(parseInt(h,16)*f))).toString(16).padStart(2,'0')).join('');

  // An axis-aligned box: top, front-left (+y) and front-right (+x) faces are the visible ones.
  function box(x,y,z,w,d,h,color,extra=''){
    const top=[P(x,y,z+h),P(x+w,y,z+h),P(x+w,y+d,z+h),P(x,y+d,z+h)];
    const left=[P(x,y+d,z),P(x+w,y+d,z),P(x+w,y+d,z+h),P(x,y+d,z+h)];
    const right=[P(x+w,y,z),P(x+w,y+d,z),P(x+w,y+d,z+h),P(x+w,y,z+h)];
    return {depth:x+y+w/2+d/2+z*0.01,svg:`<g ${extra}><polygon points="${pts(top)}" fill="${color}"/><polygon points="${pts(left)}" fill="${shade(color,.78)}"/><polygon points="${pts(right)}" fill="${shade(color,.62)}"/></g>`,points:[...top,...left,...right]};
  }

  const STATUS_DOT={expired:'#ff8a7a',replace_soon:'#ff8a7a',due_spares_on_hand:'#f0c45a',ok:'#9be08a'};

  // Where each piece of equipment sits, and the boxes that draw it. Units are floor tiles.
  const LAYOUT={
    'UPS-A':{anchor:[1.1,2.6,1.5],boxes:[0,1,2,3].map(i=>[0.6,1+i*0.95,0.3,0.9,0.85,1.5,'#d9ddd6'])},
    'BS-A1':{anchor:[1.1,6.6,1.3],boxes:[0,1,2].map(i=>[0.6,5.2+i*0.95,0.3,0.9,0.85,1.3,'#4a5650'])},
    'CRAH-3':{anchor:[14.9,8.8,1.9],boxes:[[14.2,8,0.3,1.3,1.6,1.9,'#c9d3cc']]},
    'GEN-1':{anchor:[10.5,12.7,1.6],boxes:[[9,12,0,3,1.5,1.4,'#7d8a52'],[9.4,12.3,1.4,0.6,0.6,0.5,'#5e6a3c']]},
  };

  function scene(equipment){
    const shapes=[];
    const add=s=>shapes.push(s);

    // Ground: yard, parking bays and the building slab.
    const ground=[box(-1,10.8,-0.15,18,5.2,0.15,'#9aa39b').svg];
    for(let i=0;i<8;i++)ground.push(`<polyline points="${pts([P(0.5+i*1.1,14.3,0),P(0.5+i*1.1,15.6,0)])}" stroke="#e8ece4" stroke-width="1.4" fill="none"/>`);
    ground.push(box(0,0,0,16,11,0.3,'#e7ebe2').svg);
    // Floor grid lines in the data hall.
    for(let x=6;x<=15;x++)ground.push(`<polyline points="${pts([P(x,0.2,0.3),P(x,10.8,0.3)])}" stroke="#d3d9cf" stroke-width=".6" fill="none"/>`);

    // Back walls and the electrical room partition (drawn first, behind everything).
    const walls=[box(0,-0.25,0.3,16,0.25,2.4,'#f4f6f1').svg,box(-0.25,-0.25,0.3,0.25,11.25,2.4,'#f4f6f1').svg];

    // Data hall racks: two rows, decoration only.
    for(const row of [2,5.6])for(let i=0;i<11;i++)add(box(6.6+i*0.62,row,0.3,0.56,1.1,1.6,'#27322d'));
    // Partition between electrical room and data hall.
    add(box(4.8,0,0.3,0.18,7.5,0.9,'#f4f6f1'));
    // A second, unlabelled cooling unit for context.
    add(box(14.2,5.6,0.3,1.3,1.6,1.9,'#c9d3cc'));

    const labels=[];
    for(const e of equipment){
      const spot=LAYOUT[e.id];if(!spot)continue;
      spot.boxes.forEach(b=>add(box(...b,`class="machine" data-machine="${esc(e.id)}"`)));
      labels.push({e,at:P(...spot.anchor)});
    }

    // Low front walls so the interior stays visible, like a cutaway.
    add(box(0,11,0.3,16,0.2,0.5,'#f4f6f1'));
    add(box(16,0,0.3,0.2,11.2,0.5,'#f4f6f1'));

    shapes.sort((a,b)=>a.depth-b.depth);

    // Label pills float above each piece of equipment.
    const tags=labels.map(({e,at})=>{
      const text=`${e.id} · ${e.name}`,w=text.length*6.3+30,x=at[0]-w/2,y=at[1]-48;
      return `<g class="site-tag machine" data-machine="${esc(e.id)}" role="button" tabindex="0" aria-label="${esc(e.name)}: show parts"><line x1="${at[0].toFixed(1)}" y1="${at[1].toFixed(1)}" x2="${at[0].toFixed(1)}" y2="${(y+22).toFixed(1)}" stroke="rgba(243,246,234,.55)" stroke-width="1"/>
        <circle cx="${at[0].toFixed(1)}" cy="${at[1].toFixed(1)}" r="2.5" fill="${STATUS_DOT[e.status]}"/>
        <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="22" rx="3" fill="rgba(13,36,28,.88)" stroke="rgba(243,246,234,.28)"/>
        <circle cx="${(x+12).toFixed(1)}" cy="${(y+11).toFixed(1)}" r="4" fill="${STATUS_DOT[e.status]}"/>
        <text x="${(x+22).toFixed(1)}" y="${(y+15).toFixed(1)}" fill="#f3f6ea" font-size="11.5">${esc(text)}</text></g>`;
    });

    // View box from the drawn geometry plus room for the tags.
    const all=shapes.flatMap(s=>s.points).concat([P(-1,16),P(17,10.8),P(-1,10.8)]);
    const xs=all.map(p=>p[0]),ys=all.map(p=>p[1]);
    const minX=Math.min(...xs)-20,maxX=Math.max(...xs)+20,minY=Math.min(...ys)-70,maxY=Math.max(...ys)+16;
    return `<svg class="site-svg" viewBox="${minX.toFixed(0)} ${minY.toFixed(0)} ${(maxX-minX).toFixed(0)} ${(maxY-minY).toFixed(0)}" role="img" aria-label="Isometric drawing of Demo Site LHR-1 showing ${equipment.map(e=>e.id).join(', ')}">
      ${ground.join('')}${walls.join('')}${shapes.map(s=>s.svg).join('')}${tags.join('')}</svg>`;
  }

  return {scene,STATUS_DOT};
})();
