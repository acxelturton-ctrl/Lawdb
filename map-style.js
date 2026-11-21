/* LawDB map look: pale mint land, green parks and woods, blue water, soft white roads with warm yellow highways, grey labels (a Google Maps feel).
   LawdbMapStyle.load(name) fetches an OpenFreeMap style ("bright" or "liberty"), recolours it and resolves with the style object to give to MapLibre.
   If the style cannot be fetched it resolves with the plain style address, so a map still draws. */
(function(){
  var BASE = 'https://tiles.openfreemap.org/styles/';
  var C = {
    land: '#dcefd4', water: '#7fc4ee', waterTxt: '#2b6fa8',
    park: '#b3dca3', wood: '#9bd08b', grass: '#c3e6b4', wet: '#b7e2d1', sand: '#f1e8c4', res: '#e5f1dc', school: '#f1ebc9', hospital: '#f7dcd7', cemetery: '#c9e3bf',
    building: '#cfe2c7', road: '#ffffff', roadCasing: '#d3d6cb', major: '#fff1b8', majorCasing: '#e3c56b', motorway: '#ffd16a', motorwayCasing: '#dba43a', path: '#f3ead9', rail: '#c7c9c0',
    text: '#3c4043', poi: '#5f6368', boundary: '#9aa0a6'
  };
  function recolor(style){
    (style.layers || []).forEach(function(l){
      var id = l.id, t = l.type, sl = l['source-layer'] || '', p = l.paint = l.paint || {};
      if(t === 'background'){ p['background-color'] = C.land; return; }
      if(t === 'raster'){ p['raster-opacity'] = ['interpolate', ['linear'], ['zoom'], 0, 0.55, 6, 0.4, 8, 0]; p['raster-saturation'] = 0.2; return; }
      if(t === 'fill'){
        if(sl === 'water') p['fill-color'] = C.water;
        else if(sl === 'park') p['fill-color'] = C.park;
        else if(sl === 'landcover'){ p['fill-color'] = /wood/.test(id) ? C.wood : /grass/.test(id) ? C.grass : /wet/.test(id) ? C.wet : /sand/.test(id) ? C.sand : /ice/.test(id) ? '#ffffff' : C.grass; }
        else if(sl === 'landuse'){ p['fill-color'] = /school/.test(id) ? C.school : /hospital/.test(id) ? C.hospital : /cemetery/.test(id) ? C.cemetery : /pitch|track|park|garden|playground|zoo/.test(id) ? C.park : C.res; }
        else if(sl === 'building'){ p['fill-color'] = C.building; p['fill-opacity'] = 0.6; }
        return;
      }
      if(t === 'fill-extrusion'){ p['fill-extrusion-color'] = C.building; p['fill-extrusion-opacity'] = 0.55; return; }
      if(t === 'line'){
        if(sl === 'waterway'){ p['line-color'] = C.water; return; }
        if(sl === 'park'){ p['line-color'] = '#a6d49a'; return; }
        if(sl === 'boundary'){ p['line-color'] = C.boundary; return; }
        if(sl === 'transportation'){
          var casing = /casing/.test(id);
          if(/rail|transit/.test(id)){ p['line-color'] = C.rail; return; }
          if(/path|pedestrian/.test(id)){ p['line-color'] = C.path; return; }
          if(/motorway/.test(id)) p['line-color'] = casing ? C.motorwayCasing : C.motorway;
          else if(/trunk|primary/.test(id)) p['line-color'] = casing ? C.majorCasing : C.major;
          else p['line-color'] = casing ? C.roadCasing : C.road;
        }
        return;
      }
      if(t === 'symbol'){
        var col = sl === 'water_name' || sl === 'waterway' ? C.waterTxt : sl === 'poi' || sl === 'transportation_name' || sl === 'aerodrome_label' ? C.poi : C.text;
        p['text-color'] = col; p['text-halo-color'] = 'rgba(255,255,255,0.92)'; p['text-halo-width'] = 1.4;
      }
    });
    return style;
  }
  var cache = {};
  window.LawdbMapStyle = {
    colors: C,
    load: function(name){
      name = name || 'bright';
      if(!cache[name]) cache[name] = fetch(BASE + name).then(function(r){ if(!r.ok) throw new Error('style ' + r.status); return r.json(); }).then(recolor).catch(function(){ return BASE + name; });
      return cache[name];
    }
  };
})();
