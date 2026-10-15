(function(){
  var toggle = document.getElementById('menuToggle');
  var closeBtn = document.getElementById('menuClose');
  var overlay = document.getElementById('menuOverlay');
  var drawer = document.getElementById('menuDrawer');
  function openMenu(){ overlay.classList.add('open'); drawer.classList.add('open'); }
  function shutMenu(){ overlay.classList.remove('open'); drawer.classList.remove('open'); }
  if(toggle) toggle.addEventListener('click', openMenu);
  if(closeBtn) closeBtn.addEventListener('click', shutMenu);
  if(overlay) overlay.addEventListener('click', shutMenu);
})();
