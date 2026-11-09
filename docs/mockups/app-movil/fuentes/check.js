// ?check=1: marca en <body data-overflow> las páginas cuyo contenido pisa el pie o se sale.
(function () {
  if (!new URLSearchParams(location.search).get('check')) return;
  var bad = [];
  document.querySelectorAll('.page').forEach(function (p, i) {
    var foot = p.querySelector('.foot').getBoundingClientRect();
    var pr = p.getBoundingClientRect();
    p.querySelectorAll('.info, .cover__grid').forEach(function (c) {
      var r = c.getBoundingClientRect();
      var over = Math.round(Math.max(r.bottom - foot.top, c.scrollHeight - c.clientHeight, r.bottom - pr.bottom));
      if (over > 0) bad.push((i + 1) + ':' + over + 'px');
    });
  });
  document.body.setAttribute('data-overflow', bad.join(' ') || 'none');
})();
// ?only=N: deja sólo la página N (para revisar una página suelta en pantalla).
(function () {
  var n = new URLSearchParams(location.search).get('only');
  if (!n) return;
  document.querySelectorAll('.page').forEach(function (p, i) { if (String(i + 1) !== n) p.remove(); });
})();
