/**
 * Comparte un reporte en texto plano por WhatsApp. Intenta, en orden:
 *  1. `navigator.share` (menú nativo de compartir en móvil).
 *  2. Abrir `https://wa.me/?text=...` en una pestaña nueva (WhatsApp Web / app).
 *  3. Copiar el texto al portapapeles como último recurso.
 *
 * @param {string} text
 * @param {(msg: string) => void} [notify] callback para avisar al usuario (toast).
 */
export async function shareReportByWhatsapp(text, notify) {
  if (navigator.share) {
    try {
      await navigator.share({ text });
      return;
    } catch (err) {
      // El usuario canceló el diálogo nativo: no seguimos con los fallbacks.
      if (err && err.name === 'AbortError') return;
    }
  }

  const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
  const win = window.open(url, '_blank', 'noopener,noreferrer');
  if (win) return;

  try {
    await navigator.clipboard.writeText(text);
    notify?.('No se pudo abrir WhatsApp; copiamos el reporte al portapapeles.');
  } catch {
    notify?.('No se pudo abrir WhatsApp ni copiar el texto. Copialo manualmente desde el reporte.');
  }
}
