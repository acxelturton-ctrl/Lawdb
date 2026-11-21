/* The province practice pages: a firm's logo that does not load turns into the firm's initials (the same fallback as the city pages). The pages are complete
   without this file. Nothing here sends anything about the visitor. */
(function () {
  'use strict';
  function mono(img) {
    var tile = img.parentNode;
    if (!tile || tile.classList.contains('pp-mono')) return;
    tile.classList.add('pp-mono');
    var b = document.createElement('b');
    b.setAttribute('aria-hidden', 'true');
    b.textContent = img.getAttribute('data-mono') || '';
    tile.replaceChild(b, img);
  }
  document.addEventListener('error', function (e) {
    var img = e.target;
    if (img && img.tagName === 'IMG' && img.hasAttribute('data-mono')) mono(img);
  }, true);
  /* a logo that failed before this file ran */
  [].forEach.call(document.querySelectorAll('img[data-mono]'), function (img) {
    if (img.complete && img.naturalWidth === 0) mono(img);
  });
})();
