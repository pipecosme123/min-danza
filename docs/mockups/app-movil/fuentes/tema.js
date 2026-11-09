// Tema alternativo: <tablero>.html?tema=oscuro|claro agrega la clase
// "tema-<x>" a <html> y carga "<diseño>-<x>.css" (p. ej. a-celebracion-oscuro.css)
// después de la hoja del diseño, para que sus reglas la sobrescriban.
(function () {
  var tema = new URLSearchParams(location.search).get('tema');
  if (!tema) return;
  document.documentElement.classList.add('tema-' + tema);
  var base = document.querySelector('link[data-diseno]');
  var link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = base.getAttribute('data-diseno') + '-' + tema + '.css';
  document.head.appendChild(link);
  var t = document.querySelector('.board__title');
  if (t) t.insertAdjacentHTML('beforeend', ' <span class="board__tema">· tema ' + tema + '</span>');
})();
// Texto de presentación propio del tema: <p class="board__notes" data-nota-<tema>="...">.
(function () {
  var tema = new URLSearchParams(location.search).get('tema');
  var p = tema && document.querySelector('.board__notes');
  var txt = p && p.getAttribute('data-nota-' + tema);
  if (txt) p.innerHTML = txt;
})();
