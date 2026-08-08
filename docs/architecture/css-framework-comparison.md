# Evaluación: ¿migrar el frontend a un framework de CSS?

**Estado:** borrador de arquitectura — **pendiente de revisión por `frontend-developer`** antes de presentarlo como recomendación final al usuario.
**Fecha:** 2026-08-07
**Autor:** rol arquitecto. Perspectiva de sistema/mantenimiento; la validación de usabilidad concreta la aporta `frontend-developer`.
**Alcance:** decidir si `/client` migra de CSS plano + tokens a Bootstrap 5, Tailwind CSS o Material UI (MUI). Incluye la cuarta opción: **no migrar**.

---

## 0. TL;DR

Se midieron los cuatro caminos con builds reales en esta misma máquina. El resultado que decide el caso:

> El CSS **completo** de la app actual (20+ componentes, tokens, tema claro/oscuro, reset, utilidades) pesa **3.17 kB gzip**.
> El CSS que emite Tailwind v4 para una demo de **siete elementos** pesa **3.10 kB gzip**.

No hay ganancia de rendimiento disponible en ninguna dirección para la parte de CSS: el enfoque actual ya está en el óptimo. Lo que sí está en juego es **velocidad de desarrollo en las fases 2-7** y **accesibilidad de los componentes interactivos**, y ahí ninguno de los tres frameworks resuelve el problema real que tiene este repo hoy (ver §6, hallazgo del `Modal`).

**Recomendación preliminar: no migrar a Bootstrap, Tailwind ni MUI.** Mantener `tokens.css` + CSS por componente, e invertir una fracción del presupuesto de migración en primitivas *headless* accesibles (Radix) solo donde el comportamiento es difícil (diálogo, select, tabs, toast). Detalle y trade-offs en §7.

---

## 1. Estado real verificado del repo

Verificado contra el código, no contra el plan.

| Hecho | Valor medido |
|---|---|
| Dependencias de `/client` | `react` 19.2.8, `react-dom`, `react-router-dom` 7.18.2. **Cero librerías de UI/CSS** |
| Build de producción actual | JS **250.15 kB** raw / **79.53 kB** gzip · CSS **14.41 kB** raw / **3.17 kB** gzip |
| CSS total escrito a mano | **1087 líneas** (`tokens.css` 119 + `global.css` 157 + **811** repartidas en 19 archivos por componente) |
| Archivo de CSS más grande | `Button.css`, 96 líneas |
| Clases CSS distintas definidas | 107 |
| Ocurrencias de `className=` en JSX | 108 |
| Usos de `var(--token)` en CSS | 280 |
| Superficie JSX de componentes + páginas | 1181 líneas en 36 archivos `.jsx` |
| Acoplamiento de las pruebas al CSS | **Ninguno** — los tests usan `getByRole` (4), `queryByRole`, `queryByLabelText`, `getByText`. No hay `querySelector` por clase |

Dos observaciones que importan para la decisión:

1. **La disciplina de tokens se está cumpliendo de verdad.** 280 usos de `var(--...)` contra 0 colores sueltos relevantes; `tokens.css` documenta explícitamente la regla y la justificación de contraste AA/AAA. Esto no es un "CSS plano" improvisado: es un sistema de diseño pequeño y coherente. Cualquier framework tiene que superar eso, no solo igualarlo.
2. **El CSS por componente es diminuto.** Mediana ~40 líneas. La hipótesis habitual que justifica migrar ("el CSS a mano no escala, se vuelve inmanejable") no está ocurriendo aquí todavía, y con 1087 líneas está muy lejos de ocurrir.

### Discrepancia a corregir (fuera del alcance de este documento pero conviene registrarla)

`CLAUDE.md` §Estado dice literalmente *"Aún no se ha escrito código"*, y `docs/architecture/phase1-schema-design.md` dice *"Estado real del repo al escribir esto: vacío"*. Ambas afirmaciones son falsas hoy: la Fase 1 está construida y el build pasa. **`CLAUDE.md` debe actualizarse**, porque es el documento que orienta a toda sesión futura y hoy induce a error sobre el punto de partida.

---

## 2. Qué está realmente en juego

Restricciones que la decisión no puede romper (de `CLAUDE.md` y del mandato de accesibilidad):

- **Rango de edad amplio, incluye adultos mayores.** Texto base grande (hoy 17px, no 16), áreas táctiles **≥44px**, contraste AA/AAA.
- **Tema claro/oscuro real**, controlado por `ThemeContext.jsx` vía atributo `data-theme` en `<html>`, con persistencia en `localStorage` y seguimiento en vivo de `prefers-color-scheme` mientras el usuario no elija manualmente.
- **Página pública sin login**, que es la que consume la mayoría de la gente — probablemente desde móvil y en una sola visita. Ahí el peso del bundle es un costo de usabilidad real, no un detalle de ingeniería.
- **Fases 2-7 siguen construyendo sobre este frontend**: gestión de personas (tabla + carga CSV), generación de equipos, calendario/balance, uniformes, eventos. Es decir: **muchas tablas, formularios y diálogos de confirmación** por delante. Ahí es donde un framework podría pagar.

Los tres criterios que pidió el usuario, traducidos a algo evaluable:

- **Rapidez** = cuántos componentes de las fases 2-7 salen sin escribir CSS ni comportamiento, **menos** el costo de migrar lo ya hecho.
- **Usabilidad** = accesibilidad por defecto (foco, roles ARIA, teclado) + cumplimiento de los mandatos de tamaño y contraste **sin pelear** con los defaults.
- **Minimalismo** = qué tan cerca está el look por defecto del objetivo, y cuánto override hace falta para llegar.

---

## 3. Metodología de las mediciones

No se citan cifras de memoria. Todo lo de §4 se midió el 2026-08-07 así:

- Proyecto de banco de pruebas aislado, `vite build` de producción, **misma app mínima en las 6 variantes**: cabecera + botón + input + select + badge + tabla + modal con estado abierto/cerrado.
- Versiones instaladas: `react` 19.2.8, `vite` 8.2.1, `bootstrap` 5.3.8, `tailwindcss` 4.3.3 (+ `@tailwindcss/vite`), `@mui/material` 9.3.1 (+ `@emotion/react`/`styled`), `react-bootstrap` 2.10.10, `@radix-ui/react-dialog` 1.1.23.
- MUI se importó con **imports por ruta** (`@mui/material/Button`, etc.), que es el caso favorable para tree-shaking.
- Gzip reportado por el propio Vite; los tamaños de `bootstrap.min.css` se confirmaron además con `gzip -9` directo sobre el archivo distribuido.
- Métricas de ecosistema tomadas de la API pública de npm (descargas de la última semana y fecha de publicación de la última versión estable), no de impresiones.

**Limitación honesta:** el banco de pruebas mide el *piso* de cada opción (coste de entrada). No mide cómo crece cada uno al llegar a las ~40 pantallas finales. Tailwind y el CSS a mano crecen sublinealmente (reutilización de utilidades/tokens); MUI crece por componente nuevo importado; Bootstrap ya paga todo su CSS por adelantado. La dirección de las conclusiones no cambia, pero las magnitudes finales sí variarán.

---

## 4. Mediciones

### 4.1 Peso del bundle (build de producción, gzip)

| Variante | JS raw | JS gzip | CSS raw | CSS gzip | **Δ total gzip vs. React puro** |
|---|---:|---:|---:|---:|---:|
| React puro (línea base) | 191.02 kB | 60.13 kB | — | — | — |
| **Tailwind 4.3.3** | 191.98 kB | 60.58 kB | 12.02 kB | 3.10 kB | **+3.6 kB** |
| **Tailwind + Radix Dialog** | 231.92 kB | 74.04 kB | 14.50 kB | 3.65 kB | **+17.6 kB** |
| **react-bootstrap 2.10.10 + CSS de Bootstrap** | 245.13 kB | 78.67 kB | 230.06 kB | 30.68 kB | **+49.2 kB** |
| **Bootstrap 5.3.8 (CSS + `bootstrap.bundle.min.js`)** | 270.72 kB | 83.61 kB | 230.06 kB | 30.68 kB | **+54.2 kB** |
| **MUI 9.3.1** (16 componentes importados) | 441.51 kB | 139.36 kB | 0 (CSS-in-JS) | — | **+79.2 kB** |
| *App real de hoy, para referencia* | *250.15 kB* | *79.53 kB* | *14.41 kB* | *3.17 kB* | *—* |

Lecturas relevantes:

- **MUI más que duplica el payload no-React** con solo 16 componentes. El delta de +79.2 kB gzip es, casualmente, casi idéntico al peso total actual de toda la app (82.7 kB gzip). Para una página pública consultada desde móvil, eso es el costo más alto de la tabla y sigue creciendo con cada componente nuevo. MUI v9 sigue apoyado en Emotion (runtime de CSS-in-JS); el equipo declara la independencia de Emotion como objetivo de *futuros* majors, no como algo ya disponible.
- **Bootstrap paga 30.7 kB gzip de CSS por adelantado** y, en la práctica, se usará **casi todo sin usar**: la app necesita quizá el 15% de ese CSS. Se puede recortar compilando desde Sass, pero eso añade una toolchain de Sass a un proyecto que hoy no la tiene, y el ahorro real depende de cuánto se pode.
- **Tailwind es prácticamente gratis en bundle (+3.6 kB gzip)** — pero, y esto es lo decisivo, **no compra ningún componente**. Su delta es bajo justamente porque no trae comportamiento. Los 12 kB raw de esa demo mínima son casi todos *preflight* + las variables de tema por defecto de v4; las utilidades adicionales son baratísimas. Por eso su CSS para 7 elementos ya iguala al CSS de la app completa: **no hay margen de mejora que capturar**.
- Añadir accesibilidad real sobre Tailwind (Radix) cuesta +14 kB gzip adicionales, y aun así queda por debajo de cualquier variante de Bootstrap o MUI.

### 4.2 Ecosistema y mantenimiento (API de npm, 2026-08-07)

| Paquete | Descargas/semana | Última estable | Publicada | Señal |
|---|---:|---|---|---|
| `tailwindcss` | 119.1 M | 4.3.3 | 2026-07-16 | Cadencia muy activa |
| `@radix-ui/react-dialog` | 69.2 M | 1.1.23 | 2026-07-24 | Muy activo |
| `@mui/material` | 9.9 M | 9.3.1 | **2026-08-06** | Muy activo (v9 salió recientemente) |
| `bootstrap` | 6.2 M | 5.3.8 | **2025-08-26** | **~11.5 meses sin release** |
| `react-bootstrap` | 1.5 M | 2.10.10 | **2025-05-11** | **~15 meses sin estable**; `3.0.0-beta.5` parado desde 2025-09-22 |

Esto no significa que Bootstrap esté muerto — su línea 5.3 es madura y estable, y "sin releases" también puede leerse como "sin cambios que romper". Pero **`react-bootstrap`, que es la forma realista de usar Bootstrap dentro de React, es el artefacto menos mantenido de toda la comparación**, y su v3 lleva ~10 meses en beta detenida. Adoptarlo implica apostar por una capa de adaptación estancada, justo cuando la app todavía tiene 6 fases por construir. Es el riesgo de mantenimiento más concreto de la tabla.

### 4.3 Cumplimiento de los mandatos de accesibilidad, por defecto

Verificado leyendo el CSS/JS distribuido de cada framework, no por reputación:

| | Base tipográfica por defecto | Altura efectiva del control por defecto | ¿Cumple el mandato ≥44px? |
|---|---|---|---|
| **App actual** | 17px (`--font-size-base`) | `min-height: var(--tap-target-min)` = **44px** en `.btn` | **Sí, por diseño explícito** |
| **Bootstrap 5.3.8** | `--bs-body-font-size: 1rem` (16px) | `.btn`: padding-y `.375rem` + font 1rem + line-height 1.5 ⇒ **~38px**. `.form-control`: idéntico ⇒ **~38px** | **No.** Hay que subir a `.btn-lg` (~48px, pero impone texto de 20px) o sobreescribir |
| **MUI 9.3.1** | `htmlFontSize: 16`, `typography.button` 14px | `Button` medium: `padding: 6px 16px`, `minWidth: 64` ⇒ **~36.5px** | **No.** Hay que redefinir en `components.MuiButton.styleOverrides` |
| **Tailwind 4.3.3** | Hereda del navegador (16px) | No aplica: no hay componentes | N/A — lo pones tú (`min-h-[44px]`) |

Es decir: **los dos frameworks que traen componentes incumplen por defecto el requisito de área táctil de este proyecto**, y ambos incumplen la base tipográfica de 17px. Ninguno es un impedimento (los dos son configurables), pero desmonta el argumento de "el framework me da la accesibilidad gratis": en este proyecto habría que **reconfigurar los defaults del framework para llegar a donde el CSS actual ya está**.

### 4.4 Compatibilidad con el sistema de tokens y el tema claro/oscuro existente

| | Encaje con `tokens.css` + `data-theme` |
|---|---|
| **App actual** | Es el sistema. `ThemeContext` pone `data-theme` en `<html>`, `tokens.css` invierte superficie/texto/borde y mantiene la paleta de marca constante entre temas |
| **Tailwind 4.3** | **Encaje muy bueno.** v4 es nativamente CSS-variables: `@theme` consume tokens y genera utilidades (`bg-surface`, `text-secondary`). Además, como los tokens ya se invierten solos vía `[data-theme]`, **casi no harían falta variantes `dark:`**. Requiere declarar `@custom-variant dark (&:where([data-theme="dark"] *))` porque el `dark:` por defecto de v4 sigue `prefers-color-scheme`, no un atributo |
| **MUI 9** | **Encaje bueno pero con doble sistema.** Soporta `createTheme({ colorSchemes: { light: true, dark: true }, cssVariables: { colorSchemeSelector: '[data-theme=%s]' } })`, que se engancha directo al atributo que ya escribe `ThemeContext`. El costo: la fuente de verdad pasa a ser el objeto `theme` de JS, y MUI emite su propio juego de variables `--mui-palette-*` **en paralelo** a `--color-*`. Dos vocabularios de tokens conviviendo es exactamente la clase de deriva que `tokens.css` fue escrito para evitar |
| **Bootstrap 5.3** | **Encaje regular.** Usa `data-bs-theme`, **no** `data-theme`: habría que escribir ambos atributos desde `ThemeContext` (cambio trivial) o customizar por Sass. Sus `--bs-*` son otro vocabulario paralelo, y controlar de verdad radios, tipografía y espaciado exige compilar desde Sass |

---

## 5. Cuadro comparativo

Escala: ●●● favorable · ●●○ aceptable · ●○○ desfavorable.

| Criterio | **Mantener CSS plano + tokens** | **Bootstrap 5** | **Tailwind CSS** | **MUI (Material Design)** |
|---|---|---|---|---|
| **Δ bundle (gzip, medido)** | ●●● 0 kB. Ya en el óptimo (3.17 kB de CSS total) | ●○○ +49 a +54 kB | ●●● +3.6 kB (o +17.6 con Radix) | ●○○ **+79.2 kB** y creciendo por componente |
| **Rapidez: fases 2-7** | ●○○ Cada tabla/form/diálogo se escribe a mano | ●●○ Muchos componentes listos (grid, forms, modal, tabs) | ●○○ Acelera el *estilado*, **no** aporta componentes | ●●● El más rápido en bruto: DataGrid, DatePicker, Autocomplete, Select ya hechos |
| **Rapidez: costo de migrar lo hecho** | ●●● 0 | ●○○ Reescribir 20 componentes + podar CSS propio | ●○○ Reescribir 100% del markup (108 `className`) para 0 kB de ganancia | ●○○ Reescribir 20 componentes y re-derivar los tokens al objeto `theme` |
| **Accesibilidad por defecto** | ●●○ Contraste, foco, 44px y `prefers-reduced-motion` **ya resueltos**; falta *focus trap* (ver §6) | ●●○ Modal con foco atrapado y roles; **falla 44px por defecto** | ●○○ No aporta ninguna: la carga sigue 100% en el equipo | ●●● La mejor cobertura de teclado/ARIA; **falla 44px por defecto** |
| **Theming claro/oscuro con tokens propios** | ●●● Es el diseño actual | ●●○ Atributo distinto (`data-bs-theme`) + vocabulario `--bs-*` paralelo; Sass para control real | ●●● Nativo en CSS vars; `@theme` mapea 1:1 con `tokens.css` | ●●○ `colorSchemeSelector: '[data-theme=%s]'` encaja, pero duplica el sistema de tokens en `--mui-*` |
| **Minimalismo sin pelear** | ●●● El look es exactamente el que se decida | ●○○ Estética Bootstrap muy reconocible; "no parecer Bootstrap" es trabajo activo | ●●● Sin opinión estética alguna | ●○○ Material Design es una **postura de diseño** (elevación, ripple, mayúsculas, densidad); domarlo es override permanente |
| **Ecosistema / mantenimiento** | ●●○ Depende solo del equipo; sin riesgo de terceros, sin ayuda de terceros | ●○○ 6.2 M/sem pero **11.5 meses sin release**; `react-bootstrap` 15 meses y v3 en beta parada | ●●● 119 M/sem, cadencia mensual | ●●● 9.9 M/sem, release de ayer |
| **Lock-in** | ●●● Nulo | ●●○ Medio: las clases se van a todo el markup, pero es CSS estándar | ●●○ Medio: utilidades en todo el JSX, aunque salir es mecánico y hay migración asistida | ●○○ **Alto**: componentes, `sx`, Emotion y el objeto `theme` se enredan con la lógica; salir es reescribir |
| **Riesgo sobre invariantes de dominio** | ●●● Ninguno | ●●○ Bajo | ●●○ Bajo | ●●○ Bajo, pero el refactor masivo toca `TeamCard`, `BalanceSummary`, `SlotCard`, `CalendarGrid` — justo donde vive la representación del balance y del slot doble del último domingo |

Nota sobre la última fila: la migración no cambia reglas de negocio, pero **sí obliga a tocar los componentes que renderizan las invariantes finas** (el slot único del último domingo con 2 equipos, el evento del último sábado que no cuenta en el balance, las asignaciones `locked`). Hoy esos componentes están cubiertos por solo 2 archivos de prueba. Un refactor visual masivo sobre una red de pruebas fina es un riesgo real de regresión silenciosa: nada falla, pero la pantalla deja de comunicar que ese domingo hay dos equipos.

---

## 6. Hallazgo: el problema real no es el CSS

Al auditar los componentes existentes, el CSS está sano. Lo que falta es **comportamiento accesible**. Caso concreto, en `client/src/components/ui/Modal.jsx`:

El componente hace bien casi todo — `role="dialog"`, `aria-modal`, `aria-labelledby` con `useId()`, cierre con `Escape`, bloqueo del scroll del `body`, mueve el foco al abrir y **lo devuelve al elemento que lo abrió al cerrar**. Pero solo enfoca el primer elemento focalizable:

```js
const focusable = dialogNode?.querySelector(
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
);
(focusable || dialogNode)?.focus();
```

**No hay *focus trap*.** Con `Tab` (o `Shift+Tab` desde el primer elemento) el foco sale del diálogo hacia el contenido de fondo, que sigue en el árbol de accesibilidad y no está marcado `inert` ni `aria-hidden`. Para un usuario de teclado o lector de pantalla, el diálogo de confirmación de "re-sortear equipos" —una acción destructiva— se puede abandonar sin darse cuenta. `ConfirmDialog` hereda el mismo problema por composición.

Esto reordena toda la evaluación:

- **Tailwind no arregla nada de esto.** Es el framework más barato de la tabla y también el que deja intacto el único déficit medible que tiene el frontend.
- **MUI y Bootstrap sí lo arreglan**, pero cobran entre 49 y 79 kB gzip y una reescritura completa por un problema que se resuelve con una primitiva de ~14 kB o con ~30 líneas de código propio.

---

## 7. Recomendación preliminar

**No migrar a Bootstrap, Tailwind ni MUI. Mantener `tokens.css` + CSS por componente**, y gastar una fracción del presupuesto que costaría la migración en cerrar las brechas puntuales.

El razonamiento, ordenado por los tres criterios que pidió el usuario:

**Minimalismo.** Es el criterio más limpio de resolver y descarta dos opciones. Bootstrap y Material Design **son** estéticas, no lienzos: adoptarlos y luego "minimalizarlos" es pagar el peso completo del framework y además el trabajo de contradecirlo, indefinidamente, en cada componente nuevo de las fases 2-7. El look actual ya es el que se quiera; ese criterio está ganado y migrar solo puede perderlo.

**Usabilidad.** Aquí MUI tiene el mejor argumento de los tres y hay que reconocerlo: su cobertura de teclado y ARIA es superior a lo que un equipo pequeño sostiene a mano. Pero en este proyecto concreto el argumento se debilita por dos hechos medidos: (a) MUI **incumple por defecto** los dos mandatos duros del proyecto —44px de área táctil (~36.5px reales) y base tipográfica de 17px (14-16px reales)—, así que su "accesibilidad gratis" igual exige reconfiguración para alcanzar el nivel donde el CSS actual **ya está**; y (b) el déficit real detectado (§6) es un *focus trap*, que cuesta muchísimo menos que 79 kB gzip y una reescritura. El contraste AA/AAA, el `:focus-visible` de 3px, el `prefers-reduced-motion`, el `.skip-link` y el `.visually-hidden` ya están implementados y documentados con su justificación.

**Rapidez.** Es el único criterio donde migrar tiene un caso genuino: quedan 6 fases con muchas tablas y formularios, y MUI es objetivamente el camino más rápido para eso. El caso se cae por el punto de partida: **la migración no arranca en cero, arranca en menos cero.** Hay que reescribir 20 componentes, 108 `className` y re-derivar 280 usos de tokens antes de ganar la primera hora de velocidad. Para una app de este tamaño, esa deuda no se amortiza dentro del horizonte de las fases 2-7.

### Plan alternativo propuesto (mismo objetivo, coste muy inferior)

1. **Cerrar el `focus trap` de `Modal.jsx`** — o con `@radix-ui/react-dialog` (+14 kB gzip, resuelve foco, `inert` del fondo, portal y `Escape` de una vez), o a mano en ~30 líneas. `ConfirmDialog` hereda la corrección gratis por composición. *Es la única acción realmente urgente de todo este documento.*
2. **Adoptar primitivas headless solo donde el comportamiento es difícil**, si las fases 2-7 lo piden: diálogo, `Select`/combobox (elegir equipo para un slot), tabs, toast. Se pagan de a una, conservan `tokens.css` intacto y no imponen estética.
3. **Si el CSS por componente empieza a doler**, la respuesta barata es una capa mínima de utilidades de layout en `global.css` (`stack`, `cluster`, `grid`) — no un framework. Hoy no duele: 811 líneas, mediana de 40 por componente.
4. **Reforzar las pruebas de los componentes de dominio** (`TeamCard`, `BalanceSummary`, `SlotCard`, `CalendarGrid`) antes de cualquier refactor visual futuro. Hoy hay 2 archivos de prueba en el cliente; son la red que faltaría si algún día sí se migra.

### Si el usuario decide migrar de todos modos

- **Si el criterio dominante pasa a ser "rapidez a toda costa"** y aparecen pantallas de datos densas (filtrado, orden, paginación server-side sobre el padrón de personas): **MUI**, asumiendo conscientemente el peso, el lock-in y una sesión de theming que fuerce 44px/17px desde el principio. Es la única opción cuyo argumento sobrevive al análisis.
- **Si el criterio dominante es la ergonomía de escribir estilos**: **Tailwind**, que es el que mejor convive con `tokens.css` (mapeo 1:1 vía `@theme`) y el más barato. Pero hay que decirlo sin adornos: **es una migración de comodidad, no de capacidad** — no aporta un solo componente ni un kB de mejora.
- **Bootstrap no se recomienda en ningún escenario de este proyecto**: es el peor en minimalismo, incumple 44px por defecto, cuesta 30.7 kB gzip de CSS mayormente sin usar, y su capa React (`react-bootstrap`) es el paquete menos mantenido de la comparación.

---

## 8. Lo que no sé (requiere decisión del usuario, no está en `CLAUDE.md`)

Estas preguntas pueden cambiar la recomendación y **no deben asumirse**:

1. **¿Hay preferencia estética o identidad visual?** Todo el eje "minimalismo" se evaluó como *ausencia de opinión del framework*, no contra una guía de marca. Si existe una, cambia el peso de ese criterio.
2. **¿Desde dónde consulta la gente la página pública?** Si es mayoritariamente móvil con datos limitados, el +79 kB de MUI es un costo de usabilidad, no una nota técnica. Si es wifi/escritorio, pesa menos en la decisión.
3. **¿El panel admin va a crecer hacia pantallas de datos densas?** Si el padrón llega a cientos de personas con filtros y orden, `MUI X DataGrid` es un argumento fuerte que hoy no existe.
4. **¿Van a trabajar en este código otras personas además del usuario?** Un framework mainstream tiene valor de *onboarding* que un sistema propio no tiene, por bueno que sea. Con un solo desarrollador, ese valor es casi nulo.
5. **¿Cómo será la futura fase de reporte de asistencia por líderes?** Si es móvil-first y con mucho formulario, sube el valor de una librería de componentes.
6. **¿Hay apetito por añadir una toolchain de Sass?** Es prerrequisito para que Bootstrap sea defendible en peso, y hoy el proyecto no la tiene.

---

## 9. Pendiente antes de presentar al usuario

- [x] **Revisión de `frontend-developer`**: ver §10, corregida y firmada.
- [ ] Actualizar `CLAUDE.md` §Estado, que sigue diciendo que no se ha escrito código (§1).
- [x] Independientemente de esta decisión: corregir el *focus trap* de `Modal.jsx` (§6) — hecho, ver §10.2.

---

## 10. Revisión de `frontend-developer`

**Fecha:** 2026-08-07. **Perspectiva:** haber construido a mano los ~20 componentes de Fase 1 y proyectar sobre ellos las pantallas de negocio de Fases 2-7 (import CSV, tablas de equipos, calendario/balance, generador de eventos). Confirmo el veredicto del arquitecto y lo matizo con evidencia de ergonomía concreta que el análisis de bundle no puede capturar por sí solo.

### 10.1 Rapidez y usabilidad en Fases 2-7: el CSS a mano no es el cuello de botella

Coincido en que ninguno de los tres frameworks compra velocidad neta aquí, y añado el argumento que falta en el documento original: **la velocidad de las Fases 2-7 no depende del CSS, depende de si hay primitivas reutilizables ya construidas**, y eso ya existe. `TeamCard`, `SlotCard`, `CalendarGrid` y `BalanceSummary` (Fase 1) ya son composición pura de `Table`, `Field`, `Badge`, `Modal` y `Button` — cero CSS nuevo por pantalla de negocio, solo props y markup. Las pantallas que faltan (`PeopleManager` con import CSV, `TeamGenerator`, `EventsManager`, `SpecialSaturdayManager`) van a seguir ese mismo patrón: `FileUpload` + `Table` para personas, `Table` + `Modal`/`ConfirmDialog` para equipos y eventos. Migrar a un framework no elimina ese trabajo de composición — MUI y Bootstrap también exigen ensamblar sus propios componentes en pantallas; solo cambia de dónde sale el CSS de cada pieza, y esa pieza aquí ya cuesta ~40 líneas medianas, no cero.

Dicho esto, reviso los tres casos concretos que el arquitecto no cubrió, porque sí son honestos puntos donde un framework *podría* ganar:

- **Selectores de fecha/hora** (crear evento extraordinario, configurar el sábado especial). No hace falta un date picker de librería: los turnos son fijos por fecha de calendario y hora del día, y `<input type="date">` + `<input type="time">` nativos ya son accesibles por teclado, respetan el idioma/formato del sistema operativo, y no requieren ninguna librería. Un date picker de MUI aquí sería una regresión de usabilidad para el público objetivo (interacción más compleja, ARIA que hay que auditar) a cambio de nada que el navegador no dé gratis.
- **Tablas con muchas columnas/filas** (padrón de personas creciendo a cientos). El `Table` genérico actual alcanza sin virtualización hasta varios cientos de filas sin problema de rendimiento perceptible; la necesidad real cuando el padrón crezca es **búsqueda + orden por columna**, que se añade como feature del propio `Table` (estado local, sin dependencia nueva) antes de justificar un `DataGrid`. Si algún día se habla de miles de filas con filtrado server-side, ahí sí `MUI X DataGrid` sería un argumento real — pero no es el escenario de hoy ni el de las Fases 2-7 tal como están descritas en `CLAUDE.md`.
- **Drag-and-drop para re-sortear/reasignar equipos.** Aquí no solo no gana un framework: **drag-and-drop es la opción equivocada para este dominio**, con o sin librería. El propio mandato del proyecto excluye explícitamente interacciones "hover-only o gesture-only para acciones importantes", y reasignar a una persona de equipo es exactamente ese tipo de acción para un público con rango de edad amplio y poca fluidez digital. La reasignación manual (la excepción que permite `CLAUDE.md`, ej. promover un colaborador a líder) debe resolverse con un flujo predecible tipo "seleccionar persona → botón 'Mover a equipo' → elegir equipo en un `<select>` dentro de un `Modal` → confirmar", reutilizando exactamente las primitivas que ya existen. Ningún framework de los evaluados aporta nada aquí; el patrón correcto es de interacción, no de CSS.

**Conclusión de este punto:** el CSS a mano no me va a hacer más lento en Fases 2-7; de hecho es más rápido porque ya hay primitivas listas y el dominio no pide ningún componente que el navegador o un `<select>`/`<input>` nativo no resuelvan ya. Coincido con el arquitecto en que el verdadero riesgo de velocidad es justamente el que él señala: **el costo de reescribir lo ya hecho**, no la falta de framework.

### 10.2 El *focus trap* de `Modal.jsx`: confirmado y corregido

Confirmé el hallazgo leyendo el componente yo mismo antes de tocar nada: el `useEffect` de apertura solo enfocaba el primer elemento focalizable y nunca interceptaba `Tab`/`Shift+Tab`, así que el foco podía escaparse hacia el contenido de fondo (que seguía montado, sin `inert` ni `aria-hidden`, detrás del backdrop). Confirmado también que `ConfirmDialog` heredaba el problema por composición, tal como señala el documento — es exactamente el diálogo que se usa para confirmar "volver a sortear equipos", una acción destructiva.

**Corrección aplicada en `client/src/components/ui/Modal.jsx`:** un *focus trap* de ~25 líneas dentro del mismo `handleKeyDown` que ya maneja `Escape` (no un `useEffect` ni un listener nuevo):

```js
if (event.key !== 'Tab') return;
const focusableElements = getFocusableElements(dialogNode);
// ... Shift+Tab desde el primero -> va al último;
// Tab desde el último -> vuelve al primero;
// si el foco ya está fuera del diálogo, lo trae de vuelta al primero.
```

`getFocusableElements` recalcula la lista en cada pulsación de `Tab` (no la memoriza al abrir) porque el contenido del diálogo puede cambiar mientras está abierto (ej. un `ConfirmDialog` que pasa a `loading` y deshabilita el botón de confirmar). `ConfirmDialog` recibe la corrección gratis por composición, sin tocar su código.

**Decisión: implementación propia, no Radix.** Evalué la misma disyuntiva que plantea el arquitecto y elijo la opción de ~30 líneas por tres razones concretas desde mi lado:

1. **El comportamiento que faltaba es un patrón de teclado bien documentado y acotado** (WAI-ARIA Dialog Pattern), no un problema de composición de estados difícil de sostener a mano — a diferencia de, por ejemplo, un combobox con autocompletado, donde sí compraría una primitiva headless. Esto no es "el caso difícil" que justificaría pagar una dependencia nueva.
2. **Ya teníamos el 90% del comportamiento correcto** (`role="dialog"`, `aria-modal`, `aria-labelledby`, `Escape`, devolver el foco al cerrar, bloqueo de scroll). Faltaba una sola pieza; traer Radix para esa pieza es cambiar de arquitectura de comportamiento (portal, gestión de estado propia, `data-state`) para un componente que ya funciona en todo lo demás, con el riesgo de tener que re-adaptar `Modal.css` y las pruebas de `ConfirmDialog` a un nuevo DOM.
3. **Consistencia con el veredicto de este mismo documento.** Si la conclusión de §7 es que ninguna dependencia nueva se justifica cuando el problema es puntual y acotado, mantener esa disciplina en el propio Fase-1 (donde yo mismo introduje el bug) es más coherente que aplicarla solo hacia afuera. Radix queda como opción legítima para el día en que aparezca un `Select`/combobox o un sistema de `Toast` con comportamiento genuinamente difícil de sostener a mano — no para esto.

**Verificación:** agregué `client/src/tests/Modal.test.jsx` (3 casos: `Tab` desde el último elemento vuelve al primero, `Shift+Tab` desde el primero va al último, y el botón de fondo nunca recibe foco en 6 tabulaciones). Suite completa del cliente: **11/11 pruebas pasan** (`npm run test` en `/client`). Build de producción reconstruido tras el cambio: JS 79.67 kB gzip (antes 79.53 kB; +0.14 kB por la lógica del trap, sin dependencias nuevas), CSS sin cambios (3.17 kB gzip) — el fix no movió la conclusión de §4.1 ni un decimal relevante.

### 10.3 Recomendación final conjunta (arquitectura + frontend)

**Coincidimos: no migrar a Bootstrap, Tailwind ni MUI.** Mantener `tokens.css` + CSS por componente para las Fases 2-7. Desde el ángulo de quien va a escribir esas pantallas, el argumento es incluso más fuerte que el del bundle: las primitivas de Fase 1 ya cubren el patrón de composición que esas pantallas van a necesitar, y los tres casos "difíciles" que suelen justificar un framework (fechas, tablas densas, reordenar con gestos) o bien los resuelve HTML nativo sin costo, o bien —en el caso de drag-and-drop— el framework directamente empujaría hacia un patrón de interacción que el propio proyecto debe evitar por su público objetivo.

Ajustes al plan alternativo del arquitecto, ya con el punto 1 ejecutado:

1. ~~Cerrar el *focus trap* de `Modal.jsx`~~ — **hecho** (§10.2), con implementación propia, no Radix.
2. Mantener la puerta abierta a una primitiva headless puntual (Radix u otra) el día que aparezca un componente con estado genuinamente difícil de sostener a mano — combobox de asignación de equipo a un slot, o un sistema de `Toast` con cola y auto-dismiss son los candidatos más probables en Fases 2-7. Hoy ninguno de los dos existe todavía como necesidad real.
3. Para la reasignación manual de personas entre equipos (Fase 3), usar el flujo de selección explícita (`Modal` + `<select>` + confirmación) descrito en §10.1, no drag-and-drop, independientemente de qué se decida sobre frameworks.
4. Si el padrón de personas crece a varios cientos, extender `Table` con búsqueda/orden en el propio componente antes de considerar cualquier `DataGrid` de terceros.
5. Reforzar pruebas de los componentes de dominio (`TeamCard`, `BalanceSummary`, `SlotCard`, `CalendarGrid`) antes de cualquier refactor visual futuro, como ya proponía el arquitecto — con el precedente de que `Modal.test.jsx` (§10.2) es el patrón a seguir: pruebas de comportamiento vía `getByRole`/`userEvent`, no de clases CSS.

No hay disenso entre arquitectura y frontend en este documento: el bundle ya está en el óptimo, el look ya es el que se quiere, y el único déficit real medible ya quedó cerrado sin pagar una dependencia nueva.
