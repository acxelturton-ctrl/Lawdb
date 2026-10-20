/* LawDB places: turns a town people type ("Keswick", "Bradford, ON", "Fort St John") into a spot on the map, and finds the firms nearest to a spot.
   Shared by the home page search, the Find Your Lawyer page and the map search box, so a place with no firm of its own never ends in "no match".
   LawdbPlaces.load(root)            -> Promise of the API; fetches places.json once (about 120 KB gzipped) the first time a place is needed
   LawdbPlaces.ready()               -> true once places.json has been read
   LawdbPlaces.find(text)            -> [{ name, prov, lat, lng, pop, label }] exact matches, the place with the most people first ("Keswick, ON" picks the province)
   LawdbPlaces.suggest(text, max)    -> places whose name starts with what was typed so far, biggest first
   LawdbPlaces.nearest(firms, lat, lng, { caseId, max, minCase }) -> { list: [{ f, km }], widened } the closest firms, nearest first; when fewer than
                                       `minCase` firms of the practice area are within 150 km, every kind of firm is listed and `widened` is true
   Place names come from GeoNames (CC BY 4.0); see scripts/build-places.mjs. */
(function(root){
  'use strict';
  var PROV = { 'ontario': 'ON', 'on': 'ON', 'quebec': 'QC', 'qc': 'QC', 'british columbia': 'BC', 'bc': 'BC', 'alberta': 'AB', 'ab': 'AB', 'manitoba': 'MB', 'mb': 'MB' };
  var list = null, byName = null, pending = null;

  function norm(s){
    return String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ').replace(/[.,'’]/g, ' ').replace(/[-_\/]/g, ' ')
      .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim().replace(/\bsaint\b/g, 'st').replace(/\bsainte\b/g, 'ste');
  }
  function km(a, b, c, d){
    var t = Math.PI / 180, x = Math.sin((c - a) * t / 2) * Math.sin((c - a) * t / 2) + Math.cos(a * t) * Math.cos(c * t) * Math.sin((d - b) * t / 2) * Math.sin((d - b) * t / 2);
    return 2 * 6371 * Math.asin(Math.sqrt(x));
  }
  function build(rows){
    list = rows.map(function(r){ return { name: r[0], prov: r[1], lat: r[2], lng: r[3], pop: r[4], n: norm(r[0]), label: r[0] + ', ' + r[1] }; });
    byName = {};
    list.forEach(function(p){ (byName[p.n] = byName[p.n] || []).push(p); });
    return api;
  }
  function load(base){
    if(pending) return pending;
    pending = fetch((base || '') + 'places.json').then(function(r){ return r.json(); }).then(function(j){ return build(j.places || []); }).catch(function(e){ pending = null; throw e; });
    return pending;
  }

  // "keswick", "keswick, on", "keswick ontario" -> { n: 'keswick', prov: 'ON' | null }
  function split(text){
    var raw = String(text == null ? '' : text), prov = null, n;
    var comma = raw.lastIndexOf(',');
    if(comma > 0){ var tail = norm(raw.slice(comma + 1)); if(PROV[tail]){ prov = PROV[tail]; raw = raw.slice(0, comma); } }
    n = norm(raw);
    if(!prov){
      var words = Object.keys(PROV).sort(function(a, b){ return b.length - a.length; });
      for(var i = 0; i < words.length; i++){
        var w = words[i];
        if(w.length === 2 && n.split(' ').length < 2) continue; // a lone "on" or "bc" is not a place
        if(n.length > w.length + 1 && n.slice(-(w.length + 1)) === ' ' + w){ prov = PROV[w]; n = n.slice(0, -(w.length + 1)).trim(); break; }
      }
    }
    return { n: n, prov: prov };
  }
  function bySize(a, b){ return (b.pop - a.pop) || a.name.localeCompare(b.name); }

  function find(text){
    if(!list) return [];
    var s = split(text), hit = (byName[s.n] || []).slice();
    if(s.prov){ var same = hit.filter(function(p){ return p.prov === s.prov; }); if(same.length) hit = same; }
    return hit.sort(bySize);
  }
  function suggest(text, max){
    if(!list) return [];
    var s = split(text); if(s.n.length < 2) return [];
    var out = list.filter(function(p){
      if(s.prov && p.prov !== s.prov) return false;
      return p.n.indexOf(s.n) === 0 || (s.n.length >= 4 && p.n.indexOf(' ' + s.n) !== -1);
    });
    out.sort(function(a, b){ return ((a.n === s.n ? 0 : a.n.indexOf(s.n) === 0 ? 1 : 2) - (b.n === s.n ? 0 : b.n.indexOf(s.n) === 0 ? 1 : 2)) || bySize(a, b); });
    return out.slice(0, max || 4);
  }

  function nearest(firms, lat, lng, opt){
    opt = opt || {};
    var max = opt.max || 40, minCase = opt.minCase == null ? 3 : opt.minCase, kase = opt.caseId || null;
    var all = [];
    (firms || []).forEach(function(f){ if(typeof f.lat === 'number' && typeof f.lng === 'number') all.push({ f: f, km: km(lat, lng, f.lat, f.lng) }); });
    all.sort(function(a, b){ return a.km - b.km; });
    if(!kase) return { list: all.slice(0, max), widened: false };
    var of = all.filter(function(x){ return (x.f.caseTypes || []).indexOf(kase) !== -1; });
    var close = of.filter(function(x){ return x.km <= 150; });
    if(close.length >= minCase) return { list: of.slice(0, max), widened: false };
    return { list: all.slice(0, max), widened: true };
  }

  var api = { load: load, ready: function(){ return !!list; }, build: build, find: find, suggest: suggest, nearest: nearest, norm: norm, km: km, split: split };
  if(typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LawdbPlaces = api;
})(typeof window !== 'undefined' ? window : this);
