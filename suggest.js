/* LawDB smart search, shared by the homepage hero and the Find Your Lawyer page.
   LawdbSuggest(input, box, { root, onPick(query), near, max })
   - reads "family lawyer in Ottawa" style queries (practice area + city or province)
   - suggests practice areas x cities, cities, provinces, "near me" and firm names
   - onPick(query) runs a full search; default sends people to find-lawyers?q=
   - a town with no firm of its own (Keswick) is answered with the firms nearest to it: onPlace(label, caseId) runs that search, default sends people
     to find-lawyers?near=Keswick, ON; "near me" asks the browser for the location: onNear({lat,lng}, caseId), default goes to find-lawyers?near=me
   Look and feel lives in lawdb-search.css (class names ls-*). */
(function(){
  var CASES=[
    {id:'injury',label:'Personal Injury',plural:'Personal injury lawyers',say:'personal injury lawyer',words:['personal injury','injury','injured','car accident','accident','slip and fall','whiplash','collision','wrongful death','insurance claim']},
    {id:'family',label:'Family Law',plural:'Family lawyers',say:'family lawyer',words:['family law','family','divorce','separation','separated','custody','child support','spousal support','spousal']},
    {id:'criminal',label:'Criminal Defence',plural:'Criminal defence lawyers',say:'criminal defence lawyer',words:['criminal defence','criminal defense','criminal','dui','impaired driving','impaired','assault','drug charge','charged','charges','charge','defence','defense','bail']},
    {id:'realestate',label:'Real Estate',plural:'Real estate lawyers',say:'real estate lawyer',words:['real estate','property','buying a home','selling a home','buy a house','sell a house','buy a home','sell a home','house','home','condo','closing','mortgage']},
    {id:'wills',label:'Wills & Estates',plural:'Wills & estates lawyers',say:'wills and estates lawyer',words:['wills and estates','wills','will','estate','estates','power of attorney','probate','poa','executor','inheritance']},
    {id:'business',label:'Business Law',plural:'Business lawyers',say:'business lawyer',words:['business','corporate','commercial','incorporation','contract','contracts','startup','shareholder']},
    {id:'immigration',label:'Immigration',plural:'Immigration lawyers',say:'immigration lawyer',words:['immigration','visa','permanent resident','citizenship','refugee','work permit','sponsorship']},
    {id:'employment',label:'Employment Law',plural:'Employment lawyers',say:'employment lawyer',words:['employment','wrongful dismissal','dismissal','fired','terminated','severance','workplace','harassment','labour','labor']},
    {id:'traffic',label:'Traffic Tickets',plural:'Traffic ticket lawyers',say:'traffic ticket lawyer',words:['traffic ticket','traffic','speeding','ticket','demerit points','demerit','careless driving','stunt driving']},
    {id:'litigation',label:'Civil Litigation',plural:'Civil litigation lawyers',say:'civil litigation lawyer',words:['civil litigation','litigation','lawsuit','sue','suing','civil','dispute','small claims']}
  ];
  var BYID={}; CASES.forEach(function(c){ BYID[c.id]=c; });
  var PROV_NAME={ON:'Ontario',QC:'Quebec',BC:'British Columbia',AB:'Alberta',MB:'Manitoba'};
  var PROV_WORDS={'ontario':'ON','british columbia':'BC','bc':'BC','alberta':'AB','manitoba':'MB','quebec province':'QC'};
  var CITY_ALIASES={'sudbury':'Greater Sudbury|ON','quebec':'Quebec City|QC'};
  var FILLER={};'lawyer lawyers attorney attorneys a an the i need needs find finding looking look for to hire firm firms near me in of my get want help with and at around within on qc ab mb'.split(' ').forEach(function(w){ FILLER[w]=1; });
  var POPULAR=[['family','Ottawa','ON'],['immigration','Vancouver','BC'],['realestate','Toronto','ON'],['business','Calgary','AB']];
  var ICON={
    search:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#586170" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>',
    pin:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#586170" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
    near:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#8a6224" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="3.2"/><circle cx="12" cy="12" r="7.5"/><path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3"/></svg>'
  };
  function norm(s){ return String(s==null?'':s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/&/g,' and ').replace(/[.,'’]/g,' ').replace(/[-_\/]/g,' ').replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim(); }
  function esc(t){ return String(t==null?'':t).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
  function has(pad,w){ return pad.indexOf(' '+w+' ')!==-1; }
  var WORDS=[]; CASES.forEach(function(c){ c.words.forEach(function(w){ WORDS.push({id:c.id,w:norm(w)}); }); });
  WORDS.sort(function(a,b){ return b.w.length-a.w.length; });
  function cut(pad,w){ return pad.replace(' '+w+' ',' '); }

  window.LawdbSuggest=function(input,box,opt){
    opt=opt||{};
    var root=opt.root||'', firms=null, pending=null, cities=[], items=[], active=-1, seq=0, field=input.closest('.ls-field');
    var clearBtn=field&&field.querySelector('.ls-x');
    input.setAttribute('role','combobox'); input.setAttribute('aria-autocomplete','list'); input.setAttribute('aria-expanded','false');
    if(box.id) input.setAttribute('aria-controls',box.id);
    box.setAttribute('role','listbox');

    function load(){
      if(pending) return pending;
      pending=(typeof opt.firms==='function'?Promise.resolve(opt.firms()):opt.firms?Promise.resolve(opt.firms):fetch(root+'firms_data.json').then(function(r){return r.json();})).then(function(d){
        firms=d; var seen={}; cities=[];
        d.forEach(function(f){ var k=f.city+'|'+f.province; if(!seen[k]){ seen[k]=1; cities.push({c:f.city,p:f.province,n:norm(f.city)}); } });
        cities.sort(function(a,b){ return b.n.length-a.n.length; });
        return d;
      });
      return pending;
    }
    function cityObj(name,prov){ for(var i=0;i<cities.length;i++){ if(cities[i].c===name&&cities[i].p===prov) return cities[i]; } return null; }
    /* towns without a firm of their own: places.json is fetched the first time someone types a place we do not list */
    var placesP=null, placesOK=false;
    function loadPlaces(){
      if(placesP) return placesP;
      placesP=new Promise(function(res,rej){
        function go(){ window.LawdbPlaces.load(root).then(function(){ placesOK=true; res(); },rej); }
        if(window.LawdbPlaces) return go();
        var sc=document.createElement('script'); sc.src=root+'lawdb-places.js?v=1'; sc.onload=go; sc.onerror=function(){ rej(new Error('places')); };
        document.head.appendChild(sc);
      }).catch(function(){ placesP=null; });
      return placesP;
    }
    function closestInfo(pl,kase){
      var r=window.LawdbPlaces.nearest(firms,pl.lat,pl.lng,{caseId:kase,max:1,minCase:1});
      return r.list.length?{f:r.list[0].f,km:r.list[0].km}:null;
    }
    function kmText(d){ return (d<10?d.toFixed(1):Math.round(d))+' km'; }
    // places for a typed fragment that are not already one of our firm cities
    function placeRows(frag,kase){
      if(!placesOK||!frag||frag.length<3) return [];
      return window.LawdbPlaces.suggest(frag,6).filter(function(pl){ return !cityObj(pl.name,pl.prov); }).slice(0,4);
    }
    function rowPlace(pl,kase){
      var info=closestInfo(pl,kase), what=kase?BYID[kase].plural:'Lawyers';
      return '<div class="ls-i" role="option" data-k="place" data-place="'+esc(pl.label)+'" data-case="'+(kase||'')+'"><span class="ls-ico">'+ICON.pin+'</span><span class="ls-t"><b>'+esc(pl.label)+'</b><small>'+esc(what)+' nearest to '+esc(pl.name)+'</small></span>'+(info?'<span class="ls-r">closest '+kmText(info.km)+'</span>':'')+'</div>';
    }
    function parse(raw){
      var q=norm(raw), pad=' '+q+' ', r={q:q,kase:null,city:null,prov:null,near:/ (near me|nearby|close to me|around me) /.test(pad),rest:''}, i, k;
      for(i=0;i<WORDS.length;i++){ if(has(pad,WORDS[i].w)){ r.kase=WORDS[i].id; pad=cut(pad,WORDS[i].w); break; } }
      for(i=0;i<cities.length;i++){ if(cities[i].n.length>2&&has(pad,cities[i].n)){ r.city=cities[i]; pad=cut(pad,cities[i].n); break; } }
      if(!r.city){ for(k in CITY_ALIASES){ if(has(pad,k)){ var a=CITY_ALIASES[k].split('|'); r.city=cityObj(a[0],a[1]); if(r.city){ pad=cut(pad,k); break; } } } }
      if(!r.city){ for(k in PROV_WORDS){ if(has(pad,k)){ r.prov=PROV_WORDS[k]; pad=cut(pad,k); break; } } }
      r.rest=pad.split(' ').filter(function(t){ return t&&!FILLER[t]; }).join(' ');
      return r;
    }
    function rank(a,b){ return ((b.featured?1:0)-(a.featured?1:0)) || (b.rating-a.rating) || (b.count-a.count); }
    function inCity(f,c){ return f.city===c.c&&f.province===c.p; }
    function cnt(pred){ var n=0; firms.forEach(function(f){ if(pred(f)) n++; }); return n; }
    function hasCase(f,id){ return (f.caseTypes||[]).indexOf(id)!==-1; }
    function plural(n){ return n+' firm'+(n===1?'':'s'); }

    /* ---------- row builders ---------- */
    function rowCombo(icon,main,sub,query,count,fill){
      return '<div class="ls-i" role="option" data-k="'+(fill?'fill':'pick')+'" data-q="'+esc(query)+'"><span class="ls-ico">'+ICON[icon]+'</span><span class="ls-t"><b>'+esc(main)+'</b><small>'+esc(sub)+'</small></span>'+(count!=null?'<span class="ls-r">'+plural(count)+'</span>':'')+'</div>';
    }
    function rowNear(kase){
      return '<div class="ls-i" role="option" data-k="near" data-case="'+(kase||'')+'"><span class="ls-ico">'+ICON.near+'</span><span class="ls-t"><b>Lawyers near me</b><small>Use my location</small></span></div>';
    }
    function logo(f){
      var ini=esc(f.initials||String(f.name).slice(0,2).toUpperCase());
      var u=f.logoUrl||(f.type==='logo'&&f.src?root+f.src:'');
      return '<span class="ls-logo" style="background:#2b3a4c">'+ini+(u?'<img src="'+esc(u)+'" alt="" referrerpolicy="no-referrer" loading="lazy" onerror="this.remove()" style="background:'+(f.dark?'#142434':'#fff')+'">':'')+'</span>';
    }
    function rowFirm(f,kase){
      var tag=(kase&&hasCase(f,kase))?BYID[kase].label:((f.tags&&f.tags[0])||'Law firm');
      return '<a class="ls-i ls-firm'+(f.featured?' is-feat':'')+'" role="option" data-k="firm" href="'+root+'firms/'+f.slug+'">'+logo(f)+
        '<span class="ls-t"><b>'+esc(f.name)+(f.featured?'<em class="ls-feat">Featured</em>':'')+'</b><small>'+esc(f.city)+' &middot; '+esc(tag)+'</small></span>'+
        '<span class="ls-r ls-rate"><b>&#9733; '+Number(f.rating).toFixed(1)+'</b> ('+f.count+')</span></a>';
    }
    function head(t){ return '<div class="ls-h">'+t+'</div>'; }
    function allRow(label,query){ return '<div class="ls-i ls-all" role="option" data-k="pick" data-q="'+esc(query)+'"><span class="ls-t"><b>'+esc(label)+'</b></span><span class="ls-r">Enter &#8629;</span></div>'; }
    function hint(){ return '<div class="ls-empty">No match yet. Try a city or a practice area, like <b>family lawyer in Ottawa</b>.</div>'; }

    function build(raw){
      var p=parse(raw), html='', n, list, i, k;
      var provCount=function(prov,id){ return cnt(function(f){ return f.province===prov&&(!id||hasCase(f,id)); }); };
      var cityCount=function(c,id){ return cnt(function(f){ return inCity(f,c)&&(!id||hasCase(f,id)); }); };
      if(!p.q){
        html+=head('Try');
        if(opt.near!==false) html+=rowNear(null);
        POPULAR.forEach(function(x){ var c=cityObj(x[1],x[2]); if(!c) return; html+=rowCombo('search',BYID[x[0]].plural+' in '+c.c+', '+c.p,'Popular search',BYID[x[0]].say+' in '+c.c,cityCount(c,x[0])); });
        html+=head('Or pick a practice area')+'<div class="ls-pills">'+CASES.slice(0,8).map(function(c){ return '<div class="ls-i ls-pill" role="option" data-k="fill" data-q="'+esc(c.say+' in ')+'">'+esc(c.label)+'</div>'; }).join('')+'</div>';
        return html;
      }
      if(p.kase&&p.city){
        list=firms.filter(function(f){ return inCity(f,p.city)&&hasCase(f,p.kase); });
        var note='';
        if(!list.length){ list=firms.filter(function(f){ return inCity(f,p.city); }); note=' &middot; none listed for '+esc(BYID[p.kase].label)+', showing all'; }
        list.sort(rank);
        if(p.near) html+=rowNear(p.kase);
        if(list.length){
          html+=head(esc(BYID[p.kase].label)+' in '+esc(p.city.c)+' &middot; '+plural(list.length)+(note||', Featured first'));
          html+=list.slice(0,opt.max||5).map(function(f){ return rowFirm(f,p.kase); }).join('');
          html+=allRow(list.length>(opt.max||5)?'See all '+list.length+' firms':'Show these on the map',BYID[p.kase].say+' in '+p.city.c);
        } else html+=hint();
        return html;
      }
      if(p.kase&&p.prov){
        var cs=cities.filter(function(c){ return c.p===p.prov; }).map(function(c){ return {c:c,n:cityCount(c,p.kase)}; }).filter(function(x){ return x.n>0; }).sort(function(a,b){ return b.n-a.n; }).slice(0,6);
        html+=head(esc(BYID[p.kase].label)+' in '+esc(PROV_NAME[p.prov])+' &middot; pick a city');
        html+=rowCombo('pin',BYID[p.kase].plural+' in all of '+PROV_NAME[p.prov],'Province',BYID[p.kase].say+' in '+PROV_NAME[p.prov],provCount(p.prov,p.kase));
        html+=cs.map(function(x){ return rowCombo('pin',x.c.c+', '+x.c.p,BYID[p.kase].plural+' in '+x.c.c,BYID[p.kase].say+' in '+x.c.c,x.n); }).join('');
        return html;
      }
      if(p.kase){
        var frag=p.rest, cc=cities.map(function(c){ return {c:c,n:cityCount(c,p.kase)}; }).filter(function(x){ return x.n>0&&(!frag||x.c.n.indexOf(frag)===0||x.c.n.indexOf(' '+frag)!==-1); }).sort(function(a,b){ return b.n-a.n; }).slice(0,6);
        html+=head(esc(BYID[p.kase].label)+' &middot; where are you?');
        if(!frag&&opt.near!==false) html+=rowNear(p.kase);
        html+=cc.map(function(x){ return rowCombo('pin',x.c.c+', '+x.c.p,BYID[p.kase].plural+' in '+x.c.c,BYID[p.kase].say+' in '+x.c.c,x.n); }).join('');
        if(frag&&frag.length>=3) Object.keys(PROV_WORDS).forEach(function(w){ if(w.length>3&&w.indexOf(frag)===0){ var pv=PROV_WORDS[w]; html+=rowCombo('pin',PROV_NAME[pv],BYID[p.kase].plural+' in all of '+PROV_NAME[pv],BYID[p.kase].say+' in '+PROV_NAME[pv],provCount(pv,p.kase)); } });
        var pr=placeRows(frag,p.kase);
        html+=pr.map(function(pl){ return rowPlace(pl,p.kase); }).join('');
        if(frag&&frag.length>=3&&!placesOK&&!cc.length) html+='<div class="ls-empty">Looking for &ldquo;'+esc(frag)+'&rdquo;&hellip;</div>';
        else if(frag&&!cc.length&&!pr.length&&html.indexOf('data-k="pick"')===-1) html+='<div class="ls-empty">We could not find a place called &ldquo;'+esc(frag)+'&rdquo;. Try the nearest bigger town, or <b>'+esc(BYID[p.kase].say)+' in Toronto</b>.</div>';
        return html;
      }
      if(p.city||p.prov){
        var scope=p.city?function(f){ return inCity(f,p.city); }:function(f){ return f.province===p.prov; };
        var nm=p.city?p.city.c:PROV_NAME[p.prov];
        var rows=CASES.map(function(c){ return {c:c,n:cnt(function(f){ return scope(f)&&hasCase(f,c.id); })}; }).filter(function(x){ return x.n>0; }).sort(function(a,b){ return b.n-a.n; }).slice(0,6);
        html+=head(esc(nm)+' &middot; what do you need?');
        html+=rows.map(function(x){ return rowCombo('search',x.c.plural+' in '+nm,'Practice area',x.c.say+' in '+nm,x.n); }).join('');
        if(p.city) html+=rowCombo('pin','All lawyers in '+p.city.c+', '+p.city.p,'Browse every practice area',p.city.c,cityCount(p.city));
        return html;
      }
      /* nothing recognised yet: partial words, firm names */
      n=p.q;
      var cl=n.length>=2?CASES.filter(function(c){ return c.words.some(function(w){ return norm(w).indexOf(n)===0; })||norm(c.label).indexOf(n)===0; }).slice(0,3):[];
      var ct=n.length>=2?cities.filter(function(c){ return c.n.indexOf(n)===0||c.n.indexOf(' '+n)!==-1; }).slice(0,4):[];
      var pv=n.length>=3?Object.keys(PROV_WORDS).filter(function(w){ return w.length>3&&w.indexOf(n)===0; }).map(function(w){ return PROV_WORDS[w]; }):[];
      var fm=n.length>=3?firms.filter(function(f){ return norm(f.name).indexOf(n)!==-1; }).sort(function(a,b){ var x=norm(a.name).indexOf(n)===0?0:1,y=norm(b.name).indexOf(n)===0?0:1; return (x-y)||rank(a,b); }).slice(0,4):[];
      var pls=ct.length?[]:placeRows(n,null);
      if(cl.length||ct.length||pv.length||pls.length) html+=head('Suggestions');
      html+=cl.map(function(c){ return rowCombo('search',c.plural,'Practice area · add a city',c.say+' in ',cnt(function(f){ return hasCase(f,c.id); }),true); }).join('');
      html+=ct.map(function(c){ return rowCombo('pin',c.c+', '+c.p,'City · all practice areas',c.c,cityCount(c)); }).join('');
      html+=pv.map(function(v){ return rowCombo('pin',PROV_NAME[v],'Province · pick a practice area',PROV_NAME[v]+' ',provCount(v),true); }).join('');
      html+=pls.map(function(pl){ return rowPlace(pl,null); }).join('');
      if(fm.length) html+=head('Law firms')+fm.map(function(f){ return rowFirm(f,null); }).join('');
      if(!html&&n.length>=3&&!placesOK) html='<div class="ls-empty">Looking for &ldquo;'+esc(n)+'&rdquo;&hellip;</div>';
      if(!html) html=hint();
      return html;
    }

    /* ---------- open / close / paint ---------- */
    function sync(){ if(field) field.classList.toggle('has-val',!!input.value); }
    function close(){ box.classList.remove('open'); input.setAttribute('aria-expanded','false'); input.removeAttribute('aria-activedescendant'); active=-1; }
    function paint(html){
      box.innerHTML=html; box.classList.add('open'); input.setAttribute('aria-expanded','true');
      items=[].slice.call(box.querySelectorAll('.ls-i')); active=-1;
      items.forEach(function(el,i){ el.id=(box.id||'ls')+'-o'+i; });
    }
    function render(){
      sync();
      var raw=input.value.trim(), my=++seq;
      load().then(function(){ if(my!==seq) return; paint(build(raw)); }).catch(function(){ close(); });
      // the towns can arrive before the firm list does: draw only once both are here
      if(raw.length>=3&&!placesOK) Promise.all([load(),loadPlaces()]).then(function(){ if(placesOK&&my===seq&&document.activeElement===input) paint(build(raw)); }).catch(function(){});
    }
    function setActive(i){
      items.forEach(function(e){ e.classList.remove('is-active'); });
      active=i;
      if(i>=0&&items[i]){ items[i].classList.add('is-active'); input.setAttribute('aria-activedescendant',items[i].id); items[i].scrollIntoView({block:'nearest'}); }
      else input.removeAttribute('aria-activedescendant');
    }
    function pick(q){
      close();
      if(opt.onPick) opt.onPick(q);
      else window.location.href=root+'find-lawyers?q='+encodeURIComponent(q);
    }
    function pickPlace(label,kase){
      close();
      if(opt.onPlace) opt.onPlace(label,kase);
      else window.location.href=root+'find-lawyers?near='+encodeURIComponent(label)+(kase?'&case='+encodeURIComponent(kase):'');
    }
    function fill(q){ input.value=q; input.focus(); input.dispatchEvent(new Event('input',{bubbles:true})); }
    function locateMe(){
      return new Promise(function(res,rej){
        if(!navigator.geolocation) return rej();
        navigator.geolocation.getCurrentPosition(function(pos){ res({lat:pos.coords.latitude,lng:pos.coords.longitude}); },function(){ rej(); },{timeout:9000,maximumAge:600000});
      });
    }
    /* "Lawyers near me": the lawyers closest to where the person is, whatever town that is. The spot stays in this browser tab (sessionStorage), never in the address. */
    function near(row){
      var kase=row.getAttribute('data-case')||null, sm=row.querySelector('small');
      sm.textContent='Finding where you are\u2026';
      locateMe().then(function(pos){
        close();
        if(opt.onNear){ opt.onNear(pos,kase); return; }
        try{ sessionStorage.setItem('lawdb.near',JSON.stringify({lat:Math.round(pos.lat*1000)/1000,lng:Math.round(pos.lng*1000)/1000,t:Date.now()})); }catch(e){}
        window.location.href=root+'find-lawyers?near=me'+(kase?'&case='+encodeURIComponent(kase):'');
      }).catch(function(){ sm.textContent='Location is off. No problem, type your town instead.'; });
    }

    box.addEventListener('mousedown',function(e){ if(e.target.closest&&e.target.closest('.ls-i')) e.preventDefault(); });
    box.addEventListener('click',function(e){
      var o=e.target.closest&&e.target.closest('.ls-i'); if(!o) return;
      var k=o.getAttribute('data-k'); if(k==='firm') return;
      e.preventDefault();
      if(k==='near') near(o);
      else if(k==='place') pickPlace(o.getAttribute('data-place'),o.getAttribute('data-case')||null);
      else if(k==='fill') fill(o.getAttribute('data-q'));
      else pick(o.getAttribute('data-q'));
    });
    input.addEventListener('input',render);
    input.addEventListener('focus',function(){ load(); render(); });
    input.addEventListener('keydown',function(e){
      var open=box.classList.contains('open');
      if(e.key==='ArrowDown'||e.key==='ArrowUp'){
        e.preventDefault(); if(!open){ render(); return; }
        if(!items.length) return;
        setActive(e.key==='ArrowDown'?(active+1)%items.length:(active<=0?items.length-1:active-1));
      } else if(e.key==='Enter'){
        if(open&&active>=0){ e.preventDefault(); items[active].click(); return; }
        var raw=input.value.trim();
        if(open&&raw&&items.length&&pending&&firms){
          var p=parse(raw);
          if(!p.kase&&!p.city&&!p.prov){ var first=items.filter(function(el){ return el.getAttribute('data-k')!=='near'; })[0]; if(first){ e.preventDefault(); first.click(); } }
          else if(p.kase&&!p.city&&!p.prov){ var pl=items.filter(function(el){ return el.getAttribute('data-k')==='place'; })[0]; if(pl){ e.preventDefault(); pl.click(); } }
        }
      } else if(e.key==='Escape'){ close(); }
    });
    document.addEventListener('click',function(e){
      if(e.target===input||box.contains(e.target)||(clearBtn&&clearBtn.contains(e.target))) return;
      close();
    });
    if(clearBtn){
      clearBtn.addEventListener('mousedown',function(e){ e.preventDefault(); });
      clearBtn.addEventListener('click',function(){ input.value=''; input.focus(); input.dispatchEvent(new Event('input',{bubbles:true})); });
    }
    sync();
    opt.api={ load:load, close:close, render:render, setVal:fill };
    return opt.api;
  };
})();
