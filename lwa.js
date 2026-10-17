(function(){
  var reduce=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function init(root){
    var stage=root.querySelector('.lwa-stage'),steps;
    try{steps=JSON.parse(root.getAttribute('data-steps'));}catch(e){return;}
    var ct=root.querySelector('.lwa-cap h3'),cp=root.querySelector('.lwa-cap p'),
        nav=root.querySelector('.lwa-steps'),pp=root.querySelector('.lwa-pp');
    var cur=0,timer=null,playing=!reduce,visible=false;
    steps.forEach(function(s,i){
      var b=document.createElement('button');b.type='button';b.innerHTML='<i></i><span></span>';
      b.lastChild.textContent=s.t;b.addEventListener('click',function(){go(i,true);});nav.appendChild(b);
    });
    function paint(i){
      stage.setAttribute('data-s',String(i+1));
      ct.textContent=steps[i].t;cp.textContent=steps[i].p;
      Array.prototype.forEach.call(nav.children,function(b,k){b.setAttribute('aria-current',k===i?'true':'false');b.classList.toggle('done',k<i);});
    }
    function go(i,manual){
      clearTimeout(timer);cur=i;
      if(i===0&&!manual&&!reduce){stage.setAttribute('data-s','0');setTimeout(function(){paint(0);schedule();},80);}
      else{paint(i);schedule();}
    }
    function schedule(){clearTimeout(timer);if(!playing||!visible)return;var fast=root.classList.contains('lwa--fast');timer=setTimeout(function(){go((cur+1)%steps.length);},cur===steps.length-1?(fast?2400:5200):(fast?1100:4200));}
    pp.addEventListener('click',function(){playing=!playing;pp.textContent=playing?'Pause':'Play';if(playing)schedule();else clearTimeout(timer);});
    if(reduce)pp.textContent='Play';
    paint(reduce?steps.length-1:0);cur=reduce?steps.length-1:0;
    if('IntersectionObserver' in window){
      new IntersectionObserver(function(es){visible=es[0].isIntersecting;if(visible)schedule();else clearTimeout(timer);},{threshold:.25}).observe(root);
    }else{visible=true;schedule();}
  }
  Array.prototype.forEach.call(document.querySelectorAll('.lwa'),init);
})();
