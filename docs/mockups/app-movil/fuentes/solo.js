// Modo "una sola pantalla": <board>.html?solo=N muestra sólo el teléfono N
// (1-based, sin título ni etiqueta), para exportarlo suelto a los PDF.
(function () {
  var n = new URLSearchParams(location.search).get('solo');
  if (!n) return;
  document.documentElement.classList.add('solo');
  document.querySelectorAll('.shot').forEach(function (s, i) {
    if (String(i + 1) !== n) s.remove();
  });
})();
