/* ACML 2026: finite 500-observation Kalman tracking demonstration. */
(() => {
  function init() {
    const byId = id => document.getElementById(id);
    const canvas=byId('trackingCanvas'), chart=byId('trackingRmseChart'), play=byId('trackingPlay'), restart=byId('trackingRestart'), rates=byId('contaminationButtons'), value=byId('trackingRmseValue'), progress=byId('trackingProgress');
    const needed={trackingCanvas:canvas,trackingRmseChart:chart,trackingPlay:play,trackingRestart:restart,contaminationButtons:rates,trackingRmseValue:value,trackingProgress:progress};
    const missing=Object.entries(needed).filter(([,v])=>!v).map(([k])=>k);
    if(missing.length){console.error('[ACML tracking] Missing HTML IDs:',missing.join(', '));return;}
    const ctx=canvas.getContext('2d'), rc=chart.getContext('2d');
    if(!ctx||!rc){console.error('[ACML tracking] Canvas not available');return;}
    const N=500, STEP_MS=64, DT=.065, SD=.060, Q=.38;
    let contamination=.20, running=false, index=0, seed=47, sumSq=0, state=null;
    let truths=[], estimates=[], observations=[], rmse=[0], outlierSteps=[], last=null,acc=0,raf=0,paw=null,cat=null;
    function loadImage(url){return new Promise(resolve=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>{console.warn('Icon unavailable:',url);resolve(null);};img.src=url;});}
    Promise.all([loadImage('./paw-dog.svg'),loadImage('./paw-cat.svg')]).then(imgs=>{paw=imgs[0];cat=imgs[1];render();});
    function rand(){seed=(Math.imul(1664525,seed)+1013904223)>>>0;return seed/4294967296;}
    function gauss(){const u=Math.max(rand(),1e-9),v=rand();return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v);}
    // Custom, open-ended looping trajectory inspired by the provided sketch.
    const PATH_POINTS = [
      {x:-1.05,y:-0.18},{x:-1.22,y:0.18},{x:-1.10,y:0.62},
      {x:-0.62,y:0.92},{x:0.02,y:0.88},{x:0.42,y:0.58},
      {x:0.42,y:0.18},{x:0.12,y:-0.02},{x:-0.32,y:0.02},
      {x:-0.48,y:0.25},{x:-0.35,y:0.48},{x:0.02,y:0.50},
      {x:0.42,y:0.42},{x:0.82,y:0.32},{x:1.18,y:0.18},
      {x:1.42,y:-0.10},{x:1.62,y:-0.24}
    ];
    function point(i){return PATH_POINTS[Math.max(0,Math.min(PATH_POINTS.length-1,i))];}
    function spline(p0,p1,p2,p3,t){
      const t2=t*t,t3=t2*t;
      return {
        x:.5*(2*p1.x+(-p0.x+p2.x)*t+(2*p0.x-5*p1.x+4*p2.x-p3.x)*t2+(-p0.x+3*p1.x-3*p2.x+p3.x)*t3),
        y:.5*(2*p1.y+(-p0.y+p2.y)*t+(2*p0.y-5*p1.y+4*p2.y-p3.y)*t2+(-p0.y+3*p1.y-3*p2.y+p3.y)*t3)
      };
    }
    function splineDerivative(p0,p1,p2,p3,t){
      const t2=t*t;
      return {
        x:.5*((-p0.x+p2.x)+2*(2*p0.x-5*p1.x+4*p2.x-p3.x)*t+3*(-p0.x+3*p1.x-3*p2.x+p3.x)*t2),
        y:.5*((-p0.y+p2.y)+2*(2*p0.y-5*p1.y+4*p2.y-p3.y)*t+3*(-p0.y+3*p1.y-3*p2.y+p3.y)*t2)
      };
    }
    function target(k){
      const u=Math.max(0,Math.min(N-1,k))*(PATH_POINTS.length-1)/(N-1);
      const i=Math.min(PATH_POINTS.length-2,Math.floor(u)),t=u-i;
      const p0=point(i-1),p1=point(i),p2=point(i+1),p3=point(i+2);
      const pos=spline(p0,p1,p2,p3,t),der=splineDerivative(p0,p1,p2,p3,t);
      // Derivative with respect to physical simulation time, not spline parameter.
      const factor=(PATH_POINTS.length-1)/((N-1)*DT);
      return {x:pos.x,y:pos.y,vx:der.x*factor,vy:der.y*factor};
    }
    function axis(p,v){return{p,v,a:.025,b:0,c:.13};}
    function update(s,z){const d=DT,ap=s.a+2*d*s.b+d*d*s.c+Q*d*d*d*d/4,bp=s.b+d*s.c+Q*d*d*d/2,cp=s.c+Q*d*d; s.p+=d*s.v;const den=ap+SD*SD,k0=ap/den,k1=bp/den,e=z-s.p;s.p+=k0*e;s.v+=k1*e;s.a=(1-k0)*ap;s.b=(1-k0)*bp;s.c=cp-k1*bp;}
    function advance(){if(index>=N)return;const t=target(index);let x=t.x+SD*gauss(),y=t.y+SD*gauss();const outlier=rand()<contamination;if(outlier){const a=2*Math.PI*rand(),r=.60+.55*rand();x+=r*Math.cos(a);y+=r*Math.sin(a);outlierSteps.push(index+1);}if(index){update(state.x,x);update(state.y,y);}const dx=state.x.p-t.x,dy=state.y.p-t.y;sumSq+=dx*dx+dy*dy;truths.push(t);estimates.push({x:state.x.p,y:state.y.p});observations.push({x,y,outlier});index++;rmse.push(Math.sqrt(sumSq/index));}
    function stop(){running=false;if(raf)cancelAnimationFrame(raf);raf=0;last=null;acc=0;play.textContent=index>=N?'✓ Finished':'▶ Play';play.setAttribute('aria-pressed','false');play.disabled=index>=N;}
    function reset(autoplay=true){if(raf)cancelAnimationFrame(raf);running=false;raf=0;last=null;acc=0;seed=47;index=0;sumSq=0;truths=[];estimates=[];observations=[];rmse=[0];outlierSteps=[];const t=target(0);state={x:axis(t.x,t.vx),y:axis(t.y,t.vy)};advance();play.disabled=false;render();if(autoplay)start();else stop();}
    function start(){if(index>=N)return;running=true;play.disabled=false;play.textContent='❚❚ Pause';play.setAttribute('aria-pressed','true');last=null;acc=0;raf=requestAnimationFrame(loop);}
    function loop(ts){if(!running)return;if(last===null)last=ts;acc+=Math.min(ts-last,100);last=ts;while(acc>=STEP_MS&&index<N){advance();acc-=STEP_MS;}render();if(index>=N){stop();return;}raf=requestAnimationFrame(loop);}
    function setup(c,g){const r=c.getBoundingClientRect();if(r.width<=0||r.height<=0)return null;const dpr=Math.min(window.devicePixelRatio||1,2),w=r.width,h=r.height,cw=Math.round(w*dpr),ch=Math.round(h*dpr);if(c.width!==cw||c.height!==ch){c.width=cw;c.height=ch;}g.setTransform(dpr,0,0,dpr,0,0);g.clearRect(0,0,w,h);return{w,h};}
    function trace(g,pts,px,py,color,width,dash=[]){if(pts.length<2)return;g.save();g.strokeStyle=color;g.lineWidth=width;g.setLineDash(dash);g.lineCap='round';g.lineJoin='round';g.beginPath();g.moveTo(px(pts[0]),py(pts[0]));for(let j=1;j<pts.length;j++)g.lineTo(px(pts[j]),py(pts[j]));g.stroke();g.restore();}
    function drawTrack(){const b=setup(canvas,ctx);if(!b)return;const{w,h}=b,scale=Math.min((w-34)/3.35,(h-24)/1.70),px=p=>w/2+(p.x-0.17)*scale,py=p=>h/2-(p.y-0.33)*scale;
      ctx.save();ctx.strokeStyle='rgba(190,218,229,.13)';ctx.lineWidth=.7;for(let x=20;x<w;x+=38){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.stroke();}for(let y=16;y<h;y+=38){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke();}ctx.restore();
      const planned=[];for(let k=0;k<N;k+=3)planned.push(target(k));planned.push(target(N-1));trace(ctx,planned,px,py,'rgba(202,225,239,.23)',1.3,[5,6]);
      trace(ctx,truths,px,py,'#B5D0DF',2,[6,5]);trace(ctx,estimates,px,py,'#46D4CC',2.8);
      // Keep the complete paths while showing only recent measurement icons to avoid clutter.
      const first=Math.max(0,index-55);for(let i=first;i<index;i++){if(i%2!==0)continue;const p=observations[i],img=p.outlier?cat:paw,size=p.outlier?17:14;ctx.save();ctx.globalAlpha=.65+.35*(i-first+1)/Math.max(1,index-first);if(img)ctx.drawImage(img,px(p)-size/2,py(p)-size/2,size,size);else{ctx.fillStyle=p.outlier?'#E8737D':'#A4BDCF';ctx.beginPath();ctx.arc(px(p),py(p),3.1,0,Math.PI*2);ctx.fill();}ctx.restore();}
      const t=truths[index-1];if(t){ctx.save();ctx.font='35px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('🐶',px(t),py(t));ctx.restore();}
    }
    function drawRmse(){const b=setup(chart,rc);if(!b)return;const{w,h}=b,L=35,R=9,T=8,B=21,W=w-L-R,H=h-T-B;const ymax=Math.max(.15,...rmse)*1.16;const x=n=>L+(n/N)*W,y=v=>T+H*(1-v/ymax);
      rc.save();rc.font='10px Inter, sans-serif';rc.textAlign='right';rc.fillStyle='rgba(225,238,248,.75)';for(let j=0;j<=2;j++){const v=ymax*j/2, yy=y(v);rc.fillText(v.toFixed(2),L-5,yy+3);rc.strokeStyle='rgba(196,225,238,.16)';rc.beginPath();rc.moveTo(L,yy);rc.lineTo(w-R,yy);rc.stroke();}
      // Red dashed vertical event lines mark the sample indices of contaminated measurements.
      rc.save();rc.beginPath();rc.rect(L,T,W,H);rc.clip();rc.strokeStyle='rgba(255,112,126,.34)';rc.lineWidth=.8;rc.setLineDash([3,4]);for(const n of outlierSteps){const xx=x(n);rc.beginPath();rc.moveTo(xx,T);rc.lineTo(xx,T+H);rc.stroke();}rc.restore();
      rc.fillStyle='rgba(225,238,248,.74)';rc.textAlign='center';for(const n of [0,100,200,300,400,500])rc.fillText(String(n),x(n),h-5);
      if(rmse.length>1){rc.beginPath();rc.moveTo(x(0),y(rmse[0]));for(let i=1;i<rmse.length;i++)rc.lineTo(x(i),y(rmse[i]));rc.strokeStyle='#46D4CC';rc.lineWidth=2;rc.setLineDash([]);rc.stroke();const n=rmse.length-1;rc.beginPath();rc.arc(x(n),y(rmse[n]),3,0,Math.PI*2);rc.fillStyle='#F0C46C';rc.fill();}rc.restore();
    }
    function render(){value.textContent=rmse[rmse.length-1].toFixed(3);progress.textContent=`${index} / ${N} observations`;drawTrack();drawRmse();}
    play.addEventListener('click',()=>running?stop():start());
    restart.addEventListener('click',()=>reset(true));
    rates.querySelectorAll('[data-rate]').forEach(b=>b.addEventListener('click',()=>{contamination=Number(b.dataset.rate)/100;rates.querySelectorAll('[data-rate]').forEach(t=>{const active=t===b;t.classList.toggle('active',active);t.setAttribute('aria-pressed',String(active));});reset(true);}));
    window.addEventListener('resize',render);
    reset(true);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
