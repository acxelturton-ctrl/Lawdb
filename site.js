(function(){
  function setOpen(c,o){ c.classList.toggle('open',o); var t=c.querySelector('.ls-toggle'); if(t){ t.setAttribute('aria-expanded',o); t.textContent=o?'Close':'Send message'; } }
  document.addEventListener('click',function(e){
    var t=e.target.closest('.ls-toggle');
    if(t){ var c=t.closest('.lead-slim'); setOpen(c,!c.classList.contains('open')); return; }
    var a=e.target.closest('a[href^="#leadForm-"]');
    if(a){ var f=document.getElementById(a.getAttribute('href').slice(1)); var c2=f&&f.closest('.lead-slim'); if(c2){ e.preventDefault(); setOpen(c2,true); c2.scrollIntoView({behavior:'smooth',block:'center'}); } }
  });
})();

/* swipe-row arrows */
(function(){
  document.querySelectorAll('.lw-car').forEach(function(c){
    var t=c.querySelector('.lw-track'), p=c.querySelector('.lw-prev'), n=c.querySelector('.lw-next');
    if(!t||!p||!n) return;
    function upd(){ p.disabled=t.scrollLeft<4; n.disabled=t.scrollLeft+t.clientWidth>=t.scrollWidth-4; }
    p.addEventListener('click',function(){ t.scrollBy({left:-t.clientWidth*0.8,behavior:'smooth'}); });
    n.addEventListener('click',function(){ t.scrollBy({left:t.clientWidth*0.8,behavior:'smooth'}); });
    t.addEventListener('scroll',upd,{passive:true}); window.addEventListener('resize',upd); upd();
  });
})();

/* business hours: highlight today + open-now badge (firm's own timezone) */
(function(){
  var c=document.querySelector('.hours-card'); if(!c) return;
  try{
    var tz=c.getAttribute('data-tz')||'America/Toronto';
    var parts=new Intl.DateTimeFormat('en-CA',{timeZone:tz,weekday:'short',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(new Date());
    var o={}; parts.forEach(function(p){o[p.type]=p.value;});
    var map={Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6,Sun:7};
    var d=map[o.weekday], mins=(parseInt(o.hour,10)%24)*60+parseInt(o.minute,10);
    var li=c.querySelector('li[data-d="'+d+'"]'); if(!li) return;
    li.classList.add('today');
    var open=false;
    (li.getAttribute('data-iv')||'').split(';').forEach(function(iv){
      if(!iv) return; var a=iv.split('-'), s=a[0].split(':'), e=a[1].split(':');
      var sm=+s[0]*60+(+s[1]), em=+e[0]*60+(+e[1]);
      if(mins>=sm && mins<em) open=true;
    });
    var st=c.querySelector('.hc-status'); st.hidden=false;
    st.textContent=open?'Open now':'Closed now'; if(!open) st.classList.add('off');
  }catch(e){}
})();

/* ===== polish pass: header shadow, scroll reveal, image fade, back-to-top, count-up ===== */
(function(){
  var reduce=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var hdr=document.querySelector('.site-header');
  var top=document.createElement('button'); top.type='button'; top.className='to-top'; top.setAttribute('aria-label','Back to top'); top.innerHTML='&#8593;';
  top.addEventListener('click',function(){ window.scrollTo({top:0,behavior:reduce?'auto':'smooth'}); });
  document.body.appendChild(top);
  function onScroll(){ var y=window.scrollY||0; if(hdr) hdr.classList.toggle('scrolled',y>8); top.classList.toggle('show',y>900); }
  window.addEventListener('scroll',onScroll,{passive:true}); onScroll();
  if(reduce) return;
  /* image fade for lazy images that are not loaded yet */
  document.querySelectorAll('img[loading="lazy"]').forEach(function(im){
    if(im.complete) return; im.classList.add('lz');
    var done=function(){ im.classList.add('lz-in'); }; im.addEventListener('load',done); im.addEventListener('error',done);
  });
  /* scroll reveal (only things currently below the fold) */
  if(!('IntersectionObserver' in window)) return;
  var sel='.section-head,.case-tile,.compare-card,.pillar,.news-item,.cb-col,.about-stat,.lwa-h,.lwa-lede,.guide,.services,.from-firm,.map-embed,.nearby,.lead-slim,.feat-swipe .lw-car,.cta-box,.intro';
  var vh=window.innerHeight, els=[].slice.call(document.querySelectorAll(sel)).filter(function(e){ return e.getBoundingClientRect().top>vh*0.92 && !e.closest('.lw-track'); });
  if(!els.length) return;
  var io=new IntersectionObserver(function(es){ es.forEach(function(en){ if(en.isIntersecting){ en.target.classList.add('in'); io.unobserve(en.target); } }); },{threshold:0.08,rootMargin:'0px 0px -6% 0px'});
  els.forEach(function(e,i){ var sib=[].indexOf.call(e.parentNode.children,e); e.style.setProperty('--rvd',(Math.min(sib%4,3)*0.08)+'s'); e.classList.add('rv'); io.observe(e); });
  setTimeout(function(){ document.querySelectorAll('.rv:not(.in)').forEach(function(e){ var r=e.getBoundingClientRect(); if(r.top<window.innerHeight) e.classList.add('in'); }); },2500);
  /* hero stat count-up */
  var stats=document.querySelectorAll('.h3-stats b');
  if(stats.length){ stats.forEach(function(b){ var n=parseInt(b.textContent.replace(/\D/g,''),10); if(!n) return; var t0=null,dur=1100; b.textContent='0';
    function f(t){ if(!t0) t0=t; var p=Math.min(1,(t-t0)/dur); b.textContent=Math.round(n*(1-Math.pow(1-p,3))); if(p<1) requestAnimationFrame(f); else b.textContent=n; } requestAnimationFrame(f); }); }
})();
// Once someone has signed in on this device, the site shows the member side (avatar, account panel, phone tab bar).
(function(){ try{ if(localStorage.getItem('lawdb_in')!=='1') return;
  var swap=function(){ [].forEach.call(document.querySelectorAll('a[href="/account/"]'),function(a){ if(/^\s*Sign in\s*$/.test(a.textContent)) a.textContent='My account'; });
    var s=document.createElement('script'); s.src='/lw-app.js'; s.defer=true; document.head.appendChild(s); };
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',swap); else swap(); }catch(e){} })();
