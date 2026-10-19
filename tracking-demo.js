/* ACML tracking illustration: non-robust Kalman filter and empirical running position RMSE. */
(() => {
 const canvas=document.getElementById('trackingCanvas'), chart=document.getElementById('trackingRmseChart');
 const play=document.getElementById('trackingPlay'), rateGroup=document.getElementById('contaminationButtons'), value=document.getElementById('trackingRmseValue');
 if(!canvas||!chart||!play||!rateGroup||!value)return;
 const ctx=canvas.getContext('2d'), rc=chart.getContext('2d');if(!ctx||!rc)return;
 const DT=.065, RATE=.86, SX=1.0,SY=.72,SD=.060, Q=.38,MAX=180,FRAME_MS=65;
 let contamination=.20, running=true, step=0,seed=47,clock=0,last=0,frame=0,state,observations=[],truth=[],estimates=[],history=[],sumSq=0;
 let paw=null,cat=null;
 function icon(url){return new Promise(resolve=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=()=>resolve(null);i.src=url;});}
 Promise.all([icon('./paw-dog.svg'),icon('./paw-cat.svg')]).then(a=>{paw=a[0];cat=a[1];draw();});
 function rand(){seed=(Math.imul(1664525,seed)+1013904223)>>>0;return seed/4294967296;}
 function gauss(){const u=Math.max(rand(),1e-9),v=rand();return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v);}
 function target(k){const a=-Math.PI/2+k*DT*RATE;return{x:SX*Math.cos(a),y:SY*Math.sin(a),vx:-SX*RATE*Math.sin(a),vy:SY*RATE*Math.cos(a)};}
 function axis(p,v){return{p,v,a:.025,b:0,c:.13};}
 function update(s,z){const d=DT,ap=s.a+2*d*s.b+d*d*s.c+Q*d*d*d*d/4,bp=s.b+d*s.c+Q*d*d*d/2,cp=s.c+Q*d*d;s.p+=d*s.v;const k0=ap/(ap+SD*SD),k1=bp/(ap+SD*SD),e=z-s.p;s.p+=k0*e;s.v+=k1*e;s.a=(1-k0)*ap;s.b=(1-k0)*bp;s.c=cp-k1*bp;}
 function advance(){const t=target(step);let x=t.x+SD*gauss(),y=t.y+SD*gauss(),outlier=rand()<contamination;if(outlier){let a=2*Math.PI*rand(),r=.60+.55*rand();x+=r*Math.cos(a);y+=r*Math.sin(a);}if(step){update(state.x,x);update(state.y,y);}const dx=state.x.p-t.x,dy=state.y.p-t.y;sumSq+=dx*dx+dy*dy;history.push(Math.sqrt(sumSq/(step+1)));observations.push({x,y,outlier});truth.push(t);estimates.push({x:state.x.p,y:state.y.p});if(observations.length>MAX){observations.shift();truth.shift();estimates.shift();}step++;}
 function reset(){step=0;seed=47;clock=0;observations=[];truth=[];estimates=[];history=[];sumSq=0;const t=target(0);state={x:axis(t.x,t.vx),y:axis(t.y,t.vy)};for(let k=0;k<68;k++)advance();render();}
 function prepare(c,context){const b=c.getBoundingClientRect();if(b.width<=0||b.height<=0)return null;const dpi=Math.min(devicePixelRatio||1,2);c.width=Math.floor(b.width*dpi);c.height=Math.floor(b.height*dpi);context.setTransform(dpi,0,0,dpi,0,0);context.clearRect(0,0,b.width,b.height);return{w:b.width,h:b.height};}
 function strokeLine(context,points,fx,fy,color,size,dash=[]){if(points.length<2)return;context.save();context.strokeStyle=color;context.lineWidth=size;context.setLineDash(dash);context.lineCap='round';context.lineJoin='round';context.beginPath();context.moveTo(fx(points[0]),fy(points[0]));for(let i=1;i<points.length;i++)context.lineTo(fx(points[i]),fy(points[i]));context.stroke();context.restore();}
 function draw(){const b=prepare(canvas,ctx);if(!b)return;const{w,h}=b;const s=Math.min((w-36)/3.25,(h-30)/2.95),px=p=>w/2+p.x*s,py=p=>h/2-p.y*s;
 ctx.save();ctx.strokeStyle='rgba(190,218,229,.18)';ctx.lineWidth=.8;for(let x=20;x<w;x+=38){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.stroke();}for(let y=16;y<h;y+=38){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke();}ctx.restore();
 // Context orbit visible on initial load and while the simulation is running.
 let full=[];for(let k=0;k<=160;k++){let a=-Math.PI/2+2*Math.PI*k/160;full.push({x:SX*Math.cos(a),y:SY*Math.sin(a)});}strokeLine(ctx,full,px,py,'rgba(202,225,239,.35)',1.6,[5,6]);
 strokeLine(ctx,truth,px,py,'#A9C8D8',2,[7,5]);strokeLine(ctx,estimates,px,py,'#46D4CC',3.3);
 observations.forEach((p,i)=>{if(i%2!==0)return;const img=p.outlier?cat:paw,size=p.outlier?17:15;ctx.save();ctx.globalAlpha=.35+.6*(i+1)/observations.length;if(img){ctx.drawImage(img,px(p)-size/2,py(p)-size/2,size,size);}else{ctx.fillStyle=p.outlier?'#E8737D':'#A4BDCF';ctx.beginPath();ctx.arc(px(p),py(p),3,0,Math.PI*2);ctx.fill();}ctx.restore();});
 const t=truth[truth.length-1];if(t){ctx.save();ctx.textAlign='center';ctx.textBaseline='middle';ctx.font='35px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';ctx.shadowColor='rgba(224,164,58,.4)';ctx.shadowBlur=12;ctx.fillText('🐶',px(t),py(t));ctx.restore();}
 }
 function drawRmse(){const b=prepare(chart,rc);if(!b)return;const{w,h}=b,padL=28,padR=10,padT=10,padB=20;const series=history.slice(-110);const ymax=Math.max(.15,...series)*1.2;const x=i=>padL+i/Math.max(1,series.length-1)*(w-padL-padR),y=v=>h-padB-v/ymax*(h-padT-padB);
 rc.font='10px Inter, sans-serif';rc.fillStyle='rgba(225,238,248,.72)';rc.textAlign='right';for(let i=0;i<=2;i++){const val=ymax*i/2,Y=y(val);rc.fillText(val.toFixed(2),padL-5,Y+3);rc.strokeStyle='rgba(196,225,238,.16)';rc.beginPath();rc.moveTo(padL,Y);rc.lineTo(w-padR,Y);rc.stroke();}
 rc.textAlign='right';rc.fillText('Time →',w-10,h-4);if(series.length>1){rc.beginPath();rc.moveTo(x(0),h-padB);series.forEach((v,i)=>rc.lineTo(x(i),y(v)));rc.lineTo(x(series.length-1),h-padB);rc.closePath();rc.fillStyle='rgba(70,212,204,.12)';rc.fill();rc.beginPath();series.forEach((v,i)=>i?rc.lineTo(x(i),y(v)):rc.moveTo(x(i),y(v)));rc.strokeStyle='#46D4CC';rc.lineWidth=2.1;rc.stroke();const e=series[series.length-1];rc.beginPath();rc.arc(x(series.length-1),y(e),3.3,0,Math.PI*2);rc.fillStyle='#F0C46C';rc.fill();}}
 function render(){value.textContent=history.length?history[history.length-1].toFixed(3):'–';draw();drawRmse();}
 function loop(ms){if(!running)return;if(!last)last=ms;const dt=Math.min(ms-last,80);last=ms;clock+=dt;while(clock>=FRAME_MS){advance();clock-=FRAME_MS;}render();frame=requestAnimationFrame(loop);}
 function setPlaying(next){running=next;play.textContent=next?'❚❚ Pause':'▶ Play';play.setAttribute('aria-pressed',String(next));if(frame)cancelAnimationFrame(frame);last=0;if(next)frame=requestAnimationFrame(loop);}
 play.addEventListener('click',()=>setPlaying(!running));
 rateGroup.querySelectorAll('[data-rate]').forEach(btn=>btn.addEventListener('click',()=>{contamination=Number(btn.dataset.rate)/100;rateGroup.querySelectorAll('[data-rate]').forEach(b=>{let active=b===btn;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});reset();}));
 window.addEventListener('resize',render);reset();setPlaying(true);
})();
