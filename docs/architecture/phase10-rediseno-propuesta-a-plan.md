# Fase 10 — Rediseño web con la Propuesta A («Celebración»)

> Estado: **Etapas 1 a 3 completas (2026-11-09)**; etapas 4–7 pendientes. Rama: `feature/rediseno-propuesta-a` (desde `develop`, 2026-11-08).
> Referencia visual: `docs/mockups/app-movil/` — tableros `a-celebracion*.png` (pantallas 1–12, tema claro y
> oscuro), pantallas sueltas en `pantallas/a-*.png` y la descripción completa en
> `propuesta-a-celebracion-pantallas.pdf`.

## 1. Objetivo y alcance

Llevar la identidad de la Propuesta A a la **aplicación web actual** (`/client`) antes de evaluar una app
nativa: la misma SPA, rediseñada mobile-first y con buena versión de escritorio, que además se instala
como PWA en el teléfono.

**Dentro del alcance**
- Identidad visual completa (paleta, degradado de la pandereta, tipografía, radios, sombras) en tema claro
  y oscuro.
- Las 12 pantallas de los mockups: pública (1–3), portal del líder (4–8) y administración (9–12), más las
  pantallas sin mockup (cambio de contraseña del líder, login del admin, Asistencia, Accesos, 404) con los
  mismos componentes.
- Navegación por barra de pestañas inferior en el teléfono y su equivalente en escritorio.
- Tres mejoras de UI que aparecen en los mockups y no existen hoy: «Tu próximo servicio» / «Tú» en la
  página pública, progreso y contadores en el reporte del líder, y la barra de acciones en lote de Personas
  con el nuevo estilo (la funcionalidad de lote ya existe).
- Ajustes de PWA (manifest, `theme-color`).

**Fuera del alcance**
- **Ningún cambio de backend, de API ni de reglas de negocio.** Todo lo nuevo se calcula en el cliente con
  datos que la API ya devuelve. Si en la implementación aparece algo que exija tocar `/server`, se para y se
  decide aparte.
- App nativa, notificaciones push, ingreso con huella o Face ID, service worker y modo sin conexión.
- Cambios de textos de botones o mensajes que hoy usan los tests (ver §9), salvo que se decida
  explícitamente.

## 2. Decisiones de diseño (ajustes respecto del mockup)

Los mockups priorizan la expresión visual; para producción se ajusta lo que no cumple **WCAG AA**, que es la
regla vigente de `tokens.css` (el público incluye personas mayores). Contrastes medidos:

| Par | Contraste | Decisión |
|---|---|---|
| Blanco sobre magenta `#a3189b` | 6.64 | OK |
| Blanco sobre coral `#e2374f` | 4.29 | No alcanza AA en texto normal → solo texto grande/negrita |
| Blanco sobre ámbar `#f59e0b` | 2.15 | **Falla** → el extremo ámbar no lleva texto encima |
| Coral `#e2374f` como texto sobre fondo | 4.08–4.29 | **Falla** → texto de acento con `#c81e3c` (5.67) |
| Texto secundario del mockup `#8a6f84` | 4.26 | **Falla** → `#7a5f74` (5.38) |
| Magenta `#b8198f` como texto sobre blanco | 5.88 | OK, es el color primario de texto/enlaces |
| Oscuro: magenta `#ff8ad8` / coral `#ff6b81` sobre `#241528` | 8.14 / 6.33 | OK |

En consecuencia:
1. **Dos degradados.** `--gradient-brand` (magenta → coral → ámbar, el del ícono) solo para superficies
   **decorativas o con texto grande en negrita** (hero, tarjeta destacada). `--gradient-action`
   (`#a3189b → #c81e3c → #c2410c`, mínimo 5.18 con blanco) para botones primarios, pestaña activa,
   casillas marcadas y cualquier superficie con texto normal.
2. **Los colores de acción dejan de ser constantes entre temas.** Hoy `tokens.css` declara primary/danger/
   success/warning iguales en claro y oscuro; la Propuesta A necesita acentos más luminosos en oscuro
   (`#ff8ad8`, `#ff6b81`). Se actualiza el comentario de reglas de `tokens.css` para reflejarlo.
3. **Tipografía:** Plus Jakarta Sans (400–800), **autoalojada** con `@fontsource/plus-jakarta-sans` (única
   dependencia nueva). Sin Google Fonts: evita una petición a un tercero en la página pública y no depende
   de su disponibilidad. Se mantiene la base de 17 px y el `line-height` actual.
4. **Se conservan** el objetivo táctil de 44 px, el foco visible, `prefers-reduced-motion` y el toggle de
   tema claro/oscuro existente (`ThemeContext`, `localStorage['app_theme']`).
5. **Degradado con moderación** (el «en contra» de la propuesta): como máximo un bloque con degradado por
   pantalla más la acción principal. Tarjetas, listas y formularios van en superficies planas.

## 3. Breakpoints y navegación

| Rango | Disposición |
|---|---|
| `< 768px` (teléfono) | Mockup tal cual: encabezado con degradado, una columna, barra de pestañas flotante abajo, acciones principales fijas abajo, modales como hoja inferior. |
| `768–1023px` (tablet) | Igual que teléfono con contenido a 2 columnas donde aplica (equipos, uniformes). |
| `≥ 1024px` (escritorio) | Encabezado compacto, navegación arriba (pública/líder) o **menú lateral** (admin), contenido a 2–3 columnas, tablas en Personas, modales centrados. |

Se unifican los breakpoints sueltos actuales (480/640/720/1024) en tokens `--bp-*` documentados (como
referencia: CSS no admite variables en `@media`, así que quedan como convención comentada en `tokens.css`).

**Navegación pública** (teléfono): `Inicio · Horario · Equipos · Líder`. Hoy la página pública es una sola
ruta (`/`) con secciones. Propuesta: mantener `/` y mostrar una sección por pestaña en el teléfono,
reflejando la pestaña en la URL (`/?vista=horario`) para no romper enlaces ya compartidos; en escritorio se
siguen viendo todas las secciones en una página. «Líder» lleva a `/lider/login` (o a `/lider` si hay sesión).

**Navegación admin** (teléfono): `Personas · Equipos · Eventos · Uniformes · Más`, donde **Más** abre una
hoja con Asistencia, Accesos, cambio de tema y cerrar sesión. Escritorio: menú lateral con las 6 secciones.
Rutas `/admin/*` sin cambios.

## 4. Etapas

Cada etapa termina con `npm test` y `npm run lint` en verde en `/client`, revisión visual en claro/oscuro a
390, 768 y 1280 px, y un commit propio en la rama.

### Etapa 1 — Fundamentos visuales
- `styles/tokens.css`: nueva paleta A en claro y oscuro (fondo `#fff8f4` / `#170c1a`, superficies
  `#ffffff` / `#241528`–`#2e1b33`, texto `#2b1331` / `#f8ecf4`, secundario `#7a5f74` / `#b59aae`, bordes,
  tintes `--color-tint` para avatares/chips), `--gradient-brand`, `--gradient-action`, radios más
  generosos (tarjetas 22 px, botones 16–18 px, píldoras), sombras tintadas en magenta, familia tipográfica.
- Reemplazar los **12 colores sueltos** que hoy esquivan los tokens: `NavTabs.css` (2), `Badge.css` (6),
  `Button.css` (1), `leader.css` (1) y `ColorPalettePicker.css` (2, blanco/negro del check: pueden quedar).
- `styles/global.css`: fondo, tipografía, enlaces (magenta), foco.
- `@fontsource/plus-jakarta-sans` importado en `main.jsx`.
- **Resultado esperado:** toda la app ya «se siente» A sin haber tocado ninguna página.

**Hecho (2026-11-08).** Además de lo previsto: `--color-primary` pasa a ser por tema (magenta `#a3189b` con
blanco en claro; `#ff8ad8` con tinta `#2b0a26` en oscuro) y sirve tanto de texto como de fondo, lo que
eliminó todos los parches `[data-theme='dark'] { color: #93c5fd }`; nuevos `--color-{success,danger,warning}-text`
para texto de estado (insignias y mensajes de error, que en oscuro no alcanzaban AA con el color sólido);
`--color-accent`, `--color-tint`, `--radius-xl`, `--font-weight-extrabold`, sombras por tema y
`color-scheme`. En oscuro el botón primario queda rosa con texto oscuro hasta que la Etapa 2 le aplique
`--gradient-action`.

### Etapa 2 — Componentes base (`components/ui`)
- `Button`: primario con `--gradient-action`, secundario blanco/superficie, peligro; tamaños; estado
  deshabilitado.
- `Badge`: variantes del mockup (Borrador ámbar, Enviado/abierta verde, neutro, Cancelado, Congreso,
  Instructor, Ministro, Joven, Adulto mayor, Líder/Apoyo) con sus pares de oscuro.
- `Field`, `Checkbox` (marcado con degradado), `SearchableSelect`, `FileUpload`, `Pagination`, `Table`,
  `Toast`, `Spinner`, `EmptyState`, `ErrorMessage`.
- `Modal` / `ConfirmDialog`: hoja inferior con asa en teléfono, centrado en escritorio. Conservar el manejo
  de foco (hay un test de regresión del foco en `Modal.jsx`).
- Componentes nuevos compartidos: `Avatar` (iniciales sobre tinte), `SegmentedControl` (píldoras tipo
  «Noviembre / Diciembre»), `TabBar` (barra flotante inferior), `StickyActions` (acciones fijas abajo),
  `Chip`.

**Hecho (2026-11-08).** Botón primario con `--gradient-action` y texto blanco en ambos temas, secundario
sobre superficie con texto de acción, insignias compactas sin borde (nuevo `--font-size-xs`, siempre en
negrita), foco de campos con halo tintado, casillas propias con degradado al marcarse (estilo global en
`global.css` para que el componente `Checkbox` y las casillas de selección en lote de Personas se vean
iguales; las de Personas pasan de 20 a 24 px), `Modal` como hoja inferior con asa por debajo de 768 px
(solo CSS: el manejo de foco de `Modal.jsx` no se tocó), tablas con encabezado en versalitas y sombra,
avisos con franja de estado a la izquierda, página actual de la paginación con degradado, opción resaltada
del selector con tinte en vez de fondo sólido, y anillo doble en el color elegido de la paleta.
Desviación: los componentes nuevos (`Avatar`, `SegmentedControl`, `TabBar`, `StickyActions`, `Chip`) se
crean en la etapa que los usa por primera vez, para no dejar componentes sin uso.

### Etapa 3 — Layout y navegación
- `Layout/AppHeader`: variante «hero» con degradado (pública, admin en teléfono) y variante compacta
  (escritorio). Logo según tema como hoy.
- `TabBar` pública y de admin (§3); `NavTabs` pasa a ser el menú lateral de escritorio.
- `ThemeToggle` con el nuevo estilo; en admin vive dentro de «Más».
- Espacio inferior reservado para que la barra flotante no tape contenido (`padding-bottom` +
  `env(safe-area-inset-bottom)`).

**Hecho (2026-11-09).** `AppHeader` es una franja con `--gradient-header` (nuevo token: el degradado de
acción en claro, uno más profundo en oscuro) y logo blanco en ambos temas; sus controles se redibujan en
blanco sobre el degradado y en el teléfono el tema queda solo con su ícono (el texto sigue como nombre
accesible). `NavTabs` se reemplazó por `AdminNav`: **un único `<nav>`** que por CSS es barra inferior
flotante por debajo de 1024 px (Personas · Equipos · Eventos · Uniformes · Más) y menú lateral desde 1024
px, sin duplicar enlaces. «Más» abre una hoja (`Modal`) con Asistencia, Accesos, tema y cerrar sesión; en
el panel de administración el encabezado oculta sesión y tema por debajo de 1024 px porque viven ahí.
Íconos SVG propios en `NavIcons.jsx`. Prueba nueva `AdminNav.test.jsx` (3 casos).
Desviación: la barra pública (Inicio · Horario · Equipos · Líder) y la del portal del líder pasan a la
Etapa 4, porque dependen de la decisión pendiente §9.1 sobre pestañas en la página pública.

### Etapa 4 — Página pública (pantallas 1–3)
- **Inicio:** hero con degradado, selector de mes actual/siguiente reutilizando la lógica de tabs ya
  existente (ronda 2026-08-29: el mes siguiente solo aparece si el historial lo trae), versículo del mes,
  «Tu próximo servicio» y «Esta semana».
- **Tu próximo servicio / «Tú»:** la persona elige su nombre una vez (mismo `SearchableSelect` del filtro
  actual) y se recuerda en `localStorage` (con `try/catch`; si no hay, se ofrece elegir). Se calcula en el
  cliente desde `slots` y `teams` ya devueltos por `GET /api/schedule/*`. Sin nombre elegido, la tarjeta
  invita a elegirlo.
- **Horario:** tira de la semana, buscador por nombre, filas con fecha/hora/equipo/uniforme, propios
  resaltados con «Tú»; la vista calendario (`MonthOccupancyCalendar`) sigue disponible.
- **Equipos:** «Tu equipo» destacado, demás equipos y Servicio de jóvenes.
- **Reglas que no cambian:** solo se distingue «Líder» (sin Apoyo/Ministro), nunca «Adulto mayor», nunca el
  balance; selector «Ver otro mes» solo para meses pasados.

### Etapa 5 — Portal del líder (pantallas 4–8)
- **Login** (5) con fondo degradado y tarjeta; **cambio de contraseña** con el mismo estilo.
- **Mis servicios** (6): grupos «Para registrar» (urgente con borde), «Próximos» (botón deshabilitado con
  «Abre …») y «Enviados».
- **Reporte** (4): tarjeta por integrante con 4 botones grandes (Asistió / Faltó / Remplazo / Cambio) en
  lugar de radios visibles, pero **conservando la semántica de radio** (`role="radiogroup"`, teclado) que
  usan los tests de `AttendanceReportForm`; sub-opciones Con/Sin excusa, campo de excusa, barra de progreso y
  contadores calculados en el cliente, acciones fijas abajo («Guardar» secundaria, «Enviar reporte»
  primaria). Badges del encabezado en una sola fila.
- **Resumen antes de enviar** (7): `ReportSubmitSummary` como hoja inferior con contadores y grupos.
- **Enviado** (8): confirmación, badges, vista previa del texto de WhatsApp (el mismo que devuelve
  `whatsapp-text`) y acciones «Compartir por WhatsApp» / «Volver a borrador».

### Etapa 6 — Administración (pantallas 9–12 + resto)
- **Personas** (9): encabezado con Importar/Nueva, buscador, filtros en píldora, filas con etiquetas,
  barra de acciones en lote flotante. Escritorio: tabla actual reestilizada.
- **Equipos** (10): selector de mes con estado, tarjetas por equipo (Líder con degradado, Apoyo,
  Adulto mayor), tarjeta del Servicio de jóvenes con borde propio, Re-sortear/Editar. El modal de sorteo y
  el de edición de integrantes pasan a hoja inferior en teléfono.
- **Horario y eventos** (11): `BalanceSummary` como barras, turnos con selectores de equipo/uniforme
  («Sin uniforme» en ámbar), etiquetas Congreso/Cancelado, aviso fijo «Falta para publicar» derivado del
  mismo motivo que hoy deshabilita «Finalizar mes», botón «＋». Las secciones Congresos y Versículo del mes
  se reestilizan con los mismos componentes.
- **Uniformes** (12): grilla con muestra de color e interruptor, alta/edición en hoja inferior con
  `ColorPalettePicker`.
- **Asistencia, Accesos, login admin:** sin mockup; mismos componentes y patrones.

### Etapa 7 — PWA y cierre
- `public/manifest.webmanifest`: `theme_color` / `background_color` de A (`#fff8f4`).
- `index.html`: `<meta name="theme-color">` claro `#a3189b` (barra del navegador con el color de marca) y
  oscuro `#170c1a`.
- `client/src/assets/site.webmanifest` (sin versionar, con nombre vacío) es un sobrante del generador de
  íconos y no lo usa la app: se elimina, el bueno es `public/manifest.webmanifest`.
- Actualizar `CLAUDE.md`, `README.md` y `docs/architecture/css-framework-comparison.md` (se mantiene CSS
  plano con tokens, sin framework).

## 5. Archivos principales que se tocan

| Área | Archivos |
|---|---|
| Tokens y base | `client/src/styles/tokens.css`, `global.css`, `main.jsx`, `index.html`, `public/manifest.webmanifest`, `package.json` |
| UI | `components/ui/*` (todos los `.css`, y `Modal.jsx` para la variante hoja) + nuevos `Avatar`, `SegmentedControl`, `TabBar`, `StickyActions`, `Chip` |
| Layout | `components/Layout/AppHeader.*`, `NavTabs.*`, `ThemeToggle.*` |
| Pública | `pages/PublicSchedule.*`, `components/domain/TeamCard.*`, `SlotCard.*`, `CalendarGrid.*`, `MonthOccupancyCalendar.*`, `UniformBadge.*`, `MemberList.*` |
| Líder | `pages/leader/*`, `components/domain/AttendanceReportForm.*` |
| Admin | `pages/AdminDashboard.jsx`, `PeopleManager.*`, `TeamGenerator.*`, `EventsManager.*`, `UniformsManager.*`, `AttendanceManager.jsx`, `LeaderAccountsManager.jsx`, `components/domain/BalanceSummary.*`, `ScheduleSlotCard.*`, `EventGroupsSection.*`, `MonthVersesSection.*`, `ImportReport.*`, `AdminAttendanceReportPanel.jsx` |

## 6. Verificación

- `npm test` (169 pruebas hoy) y `npm run lint` en `/client` en cada etapa; `npm run build` al final.
- Revisión visual en el navegador, tema claro y oscuro, a 390 / 768 / 1280 px, contrastando con
  `pantallas/a-*.png` y `a-oscuro-*.png`.
- Contraste AA verificado de cada par nuevo de tokens (script o herramienta de DevTools).
- Teclado: todo alcanzable y con foco visible, incluidos los botones grandes del reporte y las hojas
  inferiores.
- Flujos de punta a punta contra el backend local: público (mes actual/siguiente, persona elegida), líder
  (login → reporte → resumen → enviar → WhatsApp), admin (importar, sortear, generar horario, asignar
  uniformes, finalizar).
- Lighthouse (rendimiento/accesibilidad/PWA) en la página pública antes y después.

## 7. Entrega

- Una PR de `feature/rediseno-propuesta-a` hacia `develop`, con un commit por etapa. **No** se fusiona a
  `main` sin revisión visual del usuario en un entorno real, porque `develop → main` dispara el deploy a
  producción.
- Si se prefiere entregar por partes: las etapas 1–3 (base + navegación) pueden ir en una primera PR, ya
  que por sí solas cambian el aspecto de toda la app.

## 8. Riesgos

| Riesgo | Mitigación |
|---|---|
| Contraste del degradado y del coral | Decisiones de §2; revisar cada par nuevo. |
| Tests que dependen de estructura/clases | Conservar textos, roles ARIA y etiquetas; cambiar solo estilos y envoltorios. Si un test cambia, que sea por un cambio de UI explícito y acordado. |
| Página pública con pestañas en el teléfono | Mantener `/` y deep links; en escritorio todo visible como hoy. |
| Degradado en exceso | Regla de §2.5. |
| Alcance que crece hacia funcionalidades nuevas | Todo lo nuevo es de presentación; cualquier necesidad de backend se trata aparte. |

## 9. Decisiones a confirmar con el usuario antes de la Etapa 4

1. Pestañas en la página pública del teléfono (§3) vs. una sola página larga como hoy.
2. Guardar en el navegador el nombre elegido para «Tu próximo servicio» (no sale del dispositivo).
3. Botones grandes en lugar de radios visibles en el reporte del líder (misma semántica accesible).
