#!/bin/sh
# Renderiza cada fuentes/<x>.html a ../<x>.png (2x) con Chrome headless.
# Uso: sh fuentes/render.sh [nombre-sin-extension ...]
cd "$(dirname "$0")"
CHROME="/c/Program Files/Google/Chrome/Application/chrome.exe"
names="$*"; [ -z "$names" ] && names="a-celebracion a-celebracion-2 a-celebracion-3 b-noche b-noche-2 b-noche-3 c-agenda"
for n in $names; do
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=2 \
    --virtual-time-budget=4000 --window-size=1840,1100 \
    --screenshot="$(cygpath -w "$PWD/../$n.png")" "file:///$(cygpath -m "$PWD/$n.html")" 2>/dev/null
  echo "$n.png"
done
# Variantes de tema (tema.js): A en oscuro y B en claro, sólo si no se pidió un tablero puntual.
if [ -z "$*" ]; then
  for spec in "a-celebracion:oscuro" "a-celebracion-2:oscuro" "a-celebracion-3:oscuro" "b-noche:claro" "b-noche-2:claro" "b-noche-3:claro"; do
    src=${spec%%:*}; tema=${spec#*:}
    case $src in *-[23]) out="${src%-?}-$tema-${src##*-}" ;; *) out="$src-$tema" ;; esac
    "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=2 \
      --virtual-time-budget=4000 --window-size=1840,1100 \
      --screenshot="$(cygpath -w "$PWD/../$out.png")" "file:///$(cygpath -m "$PWD/$src.html")?tema=$tema" 2>/dev/null
    echo "$out.png"
  done
fi
