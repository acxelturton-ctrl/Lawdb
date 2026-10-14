/* LawDB hero animation: "search signals" — pulses rise from Canadian cities and connect to nearby firm dots */
(function(){
  var C=[["Toronto",-79.38,43.65,9],["Ottawa",-75.7,45.42,5],["Montreal",-73.57,45.5,6],["Quebec City",-71.21,46.81,3],["Vancouver",-123.12,49.28,6],["Calgary",-114.07,51.05,5],["Edmonton",-113.49,53.55,4],["Winnipeg",-97.14,49.9,5],["Hamilton",-79.87,43.25,3],["London",-81.25,42.98,3],["Windsor",-83.03,42.31,2],["Kitchener",-80.49,43.45,3],["Barrie",-79.69,44.39,2],["Sudbury",-81,46.49,2],["Thunder Bay",-89.25,48.38,1],["Kingston",-76.48,44.23,2],["Halifax",-63.58,44.65,3],["Saskatoon",-106.67,52.13,2],["Regina",-104.62,50.45,2],["Victoria",-123.37,48.43,2],["Kelowna",-119.5,49.89,2],["Gatineau",-75.72,45.48,2],["Mississauga",-79.64,43.59,4],["Newmarket",-79.46,44.06,2]];
  function seeded(n){return function(){n=(n*16807)%2147483647;return (n-1)/2147483646}}
  function init(hero){
    var cv=document.createElement('canvas'); cv.className='hero-canvas'; cv.setAttribute('aria-hidden','true');
    hero.insertBefore(cv,hero.firstChild);
    var x=cv.getContext('2d'), dpr=Math.min(window.devicePixelRatio||1,2), W=0,H=0, dots=[], cities=[], pulses=[], links=[];
    var reduce=window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches;
    var visible=true, raf=0, last=0, nextPulse=0;
    function proj(lon,lat){
      var wide=W>800, span=wide?72:26, cLon=wide?-90:-79.5, cLat=wide?47.5:45;
      var s=W/span, k=Math.cos(47*Math.PI/180);
      return [W/2+(lon-cLon)*s*k*1.25, H/2-(lat-cLat)*s*1.25*1.0];
    }
    function build(){
      var r=seeded(7); dots=[]; cities=[];
      C.forEach(function(c){
        var p=proj(c[1],c[2]); cities.push({n:c[0],x:p[0],y:p[1],w:c[3]});
        var n=Math.round(c[3]*(W>800?7:5));
        for(var i=0;i<n;i++){var a=r()*6.283,d=Math.pow(r(),.7)*(18+c[3]*5);dots.push({x:p[0]+Math.cos(a)*d,y:p[1]+Math.sin(a)*d*.75,r:.9+r()*1.2,glow:0,city:c[0]})}
      });
    }
    function size(){
      var b=hero.getBoundingClientRect(); W=b.width; H=b.height;
      cv.width=W*dpr; cv.height=H*dpr; x.setTransform(dpr,0,0,dpr,0,0); build();
      if(reduce||!visible) draw(0);
    }
    function pulse(){
      var tot=0,i; cities.forEach(function(c){tot+=c.w}); var t=Math.random()*tot,c;
      for(i=0;i<cities.length;i++){t-=cities[i].w; if(t<=0){c=cities[i];break}} c=c||cities[0];
      pulses.push({x:c.x,y:c.y,t:0});
      var near=dots.filter(function(d){return d.city===c.n}).sort(function(){return Math.random()-.5}).slice(0,3);
      near.forEach(function(d){links.push({x1:c.x,y1:c.y,d:d,t:-0.15})});
    }
    function draw(dt){
      x.clearRect(0,0,W,H);
      var i,d,p,l;
      for(i=0;i<dots.length;i++){d=dots[i]; d.glow=Math.max(0,d.glow-dt*.5);
        x.beginPath(); x.arc(d.x,d.y,d.r*1.15+d.glow*2.6,0,6.283);
        x.fillStyle=d.glow>0.02?'rgba(217,164,65,'+(.35+d.glow*.65)+')':'rgba(244,241,234,.42)'; x.fill();
      }
      for(i=pulses.length-1;i>=0;i--){p=pulses[i]; p.t+=dt*.45; if(p.t>=1){pulses.splice(i,1);continue}
        var rad=p.t*130, a=(1-p.t)*.6;
        x.beginPath(); x.arc(p.x,p.y,rad,0,6.283); x.strokeStyle='rgba(217,164,65,'+a+')'; x.lineWidth=1.6; x.stroke();
        x.beginPath(); x.arc(p.x,p.y,3+ (1-p.t)*2,0,6.283); x.fillStyle='rgba(217,164,65,'+(1-p.t)+')'; x.fill();
      }
      for(i=links.length-1;i>=0;i--){l=links[i]; l.t+=dt*.9; if(l.t>=1){links.splice(i,1);continue}
        if(l.t<0)continue; var e=Math.min(1,l.t*3), a2=(1-l.t)*.75;
        x.beginPath(); x.moveTo(l.x1,l.y1); x.lineTo(l.x1+(l.d.x-l.x1)*e,l.y1+(l.d.y-l.y1)*e);
        x.strokeStyle='rgba(217,164,65,'+a2*.7+')'; x.lineWidth=1; x.stroke();
        if(e>=1) l.d.glow=Math.max(l.d.glow,a2);
      }
    }
    function frame(ts){
      raf=0; if(!visible||document.hidden) return;
      var dt=Math.min(.05,(ts-(last||ts))/1000); last=ts;
      nextPulse-=dt; if(nextPulse<=0){pulse(); nextPulse=.3+Math.random()*.45}
      draw(dt); raf=requestAnimationFrame(frame);
    }
    function start(){ if(reduce||raf) return; last=0; raf=requestAnimationFrame(frame); }
    size();
    if(reduce){ for(var k=0;k<4;k++)pulse(); links.forEach(function(l){l.t=.3;l.d.glow=.6}); pulses.forEach(function(p){p.t=.35}); draw(0); }
    window.addEventListener('resize',function(){size()});
    if('IntersectionObserver' in window) new IntersectionObserver(function(es){visible=es[0].isIntersecting; if(visible)start();}).observe(hero);
    document.addEventListener('visibilitychange',function(){ if(!document.hidden)start(); });
    start();
  }
  document.addEventListener('DOMContentLoaded',function(){ var h=document.querySelector('.hero.hero-anim'); if(h) init(h); });
})();
