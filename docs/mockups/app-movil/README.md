# Mockups — app móvil nativa (para revisión y decisión)

Tres direcciones visuales para llevar la aplicación a una app móvil nativa. Cada imagen muestra las mismas
4 pantallas clave con datos de prueba de noviembre 2026, para que se puedan comparar lado a lado:

1. **Inicio** (público): próximo servicio, versículo del mes, resumen de la semana.
2. **Horario**: turnos del mes con filtro «mis turnos».
3. **Equipos**: el equipo propio con su líder e integrantes.
4. **Reporte de asistencia** (líder): el flujo de Fase 9 adaptado a pantalla táctil.

En las tres se mantienen las reglas actuales: en la vista pública solo se distingue al «Líder», los badges
del reporte quedan en una sola fila, y en el reporte las opciones son Asistió / No asistió (con o sin excusa) /
Remplazo / Cambio. La navegación es la misma en las tres (Inicio · Horario · Equipos · Líder), donde «Líder»
lleva al portal con login.

| | A · Celebración | B · Noche de adoración | C · Agenda |
|---|---|---|---|
| Imagen | `a-celebracion.png` | `b-noche.png` | `c-agenda.png` |
| Tema base | Claro | Oscuro | Claro (crema) |
| Identidad | Degradado magenta → coral → ámbar del ícono de la pandereta | Violeta tonal + acento durazno | Tipografía con serifa + un solo acento terracota |
| Sensación | Alegre, festiva, muy de marca | Sobria, moderna, cómoda de noche | Editorial, calmada, legible |
| Plataforma de referencia | iOS (barra de pestañas flotante) | Android / Material You | Neutra |
| Inicio | Tarjeta degradada «Tu próximo servicio» | Tablero: próximo turno + contadores del mes | Número de día grande + versículo destacado |
| Horario | Tira de la semana + lista con «Tú» | Chips de filtro + lista por día | Línea de tiempo vertical |
| Reporte del líder | Botones grandes de un toque, barra de progreso, «Enviar» fijo abajo | Contadores en vivo (asistieron/faltaron/remplazos), botón flotante «Enviar» | Un toque por persona (✓ ✕ ⇄), por pasos: integrantes → apoyos → novedades |
| A favor | La más reconocible y emotiva; se conecta directo con el ícono | Se ve muy actual; el oscuro descansa la vista en servicios nocturnos | La más legible para personas mayores; la que mejor envejece |
| En contra | El degradado en exceso cansa; requiere cuidar contraste del texto blanco | Menos «de marca»; en exteriores con sol el oscuro se lee peor | Puede sentirse sobria/seria para un ministerio de danza |

Cualquiera de las tres admite su versión clara u oscura; la imagen muestra el tema que mejor la representa.

## Propuestas A y B ampliadas (portal del líder)

A y B tienen 4 pantallas más, con el flujo completo del líder:

5. **Acceso de líderes**: login con usuario y contraseña.
6. **Mis servicios**: reportes pendientes, próximos y enviados, con el estado de la ventana de registro.
7. **Resumen antes de enviar**: revisar lo marcado y elegir «Modificar» o «Confirmar y enviar».
8. **Reporte enviado**: confirmación y texto para compartir por WhatsApp.

| Archivo | Contenido |
|---|---|
| `a-celebracion-2.png`, `b-noche-2.png` | Tableros con las pantallas 5 a 8 |
| `propuesta-a-celebracion-pantallas.pdf` | Descripción de las 8 pantallas de A: portada (concepto, paleta, tipografía, navegación, a favor/en contra) + una página por pantalla con quién la usa, para qué sirve, cada elemento y su uso, acciones y reglas de negocio que respeta |
| `propuesta-b-noche-pantallas.pdf` | Lo mismo para B |
| `pantallas/` | Cada pantalla de A y B como imagen suelta (`a-01.png` … `b-08.png`) |

## Propuestas A y B: vistas del administrador

A y B suman un tercer tablero con 4 pantallas del administrador, llevadas al teléfono desde las pantallas
web actuales. Al ingresar, el administrador ve su propia barra de navegación
(Personas · Equipos · Eventos · Uniformes · Más, donde «Más» agrupa Asistencia, Accesos de líderes y cerrar sesión):

9. **Personas**: búsqueda, filtros por categoría/Joven, etiquetas de Instructor, Ministro, Joven, Adulto mayor
   e Inactiva, importar CSV/Excel, alta y acciones en lote.
10. **Equipos del mes**: mes con su estado, equipos con Líder, Apoyo y la marca «Adulto mayor» (solo visible
    en administración), Servicio de jóvenes aparte, «Editar» y «Re-sortear».
11. **Horario y eventos**: balance de participaciones por equipo, turnos con selector de equipo(s) y uniforme
    («Sin uniforme» resaltado), etiquetas «Congreso» y «Cancelado», alta de eventos y el aviso de lo que
    falta para publicar el mes.
12. **Uniformes**: catálogo con activar/desactivar y la hoja de alta/edición con paleta y color personalizado.

| Archivo | Contenido |
|---|---|
| `a-celebracion-3.png`, `b-noche-3.png` | Tableros con las pantallas 9 a 12 |
| `a-celebracion-oscuro-3.png`, `b-noche-claro-3.png` | Las mismas en el tema alternativo |
| `pantallas/a-09…12.png`, `b-09…12.png`, `a-oscuro-09…12.png`, `b-claro-09…12.png` | Pantallas sueltas |

Los dos PDF ahora tienen 16 páginas: portada, una página por cada una de las 12 pantallas (las 9 a 12 con
las reglas de negocio de administración que respetan) y 3 páginas de la variante de tema (pantallas 1–4, 5–8 y 9–12).

## Variantes de tema: A oscuro y B claro

Cada una de las dos propuestas tiene también su tema opuesto, con las mismas 12 pantallas:

| Archivo | Contenido |
|---|---|
| `a-celebracion-oscuro.png`, `a-celebracion-oscuro-2.png` | **A en tema oscuro**: fondo ciruela, superficies en violeta tintado, el degradado de la pandereta se mantiene en el encabezado, la tarjeta del próximo servicio y la acción principal |
| `b-noche-claro.png`, `b-noche-claro-2.png` | **B en tema claro**: lavanda muy claro, violeta como primario fuerte y durazno como acento, pensado para exteriores y pleno día |
| `pantallas/a-oscuro-01…08.png`, `pantallas/b-claro-01…08.png` | Las pantallas sueltas de cada variante |

Los dos PDF suman 3 páginas al final (14 a 16) con su variante: descripción, qué cambia respecto del tema
base, la paleta del tema alternativo y las 12 pantallas.

Técnicamente, cada variante es una capa sobre el mismo diseño. `fuentes/tema.js` lee `?tema=oscuro|claro`
y carga `a-celebracion-oscuro.css` o `b-noche-claro.css`, que solo redefinen colores. Las pantallas, la
estructura y los textos son exactamente los mismos en ambos temas.

## Cómo regenerar las imágenes y los PDF

Las fuentes son HTML estáticos en `fuentes/`: un archivo por tablero (`base.css` tiene el marco de
teléfono; los estilos de A y B viven en `a-celebracion.css` / `b-noche.css`, compartidos por sus dos
tableros). Para volver a exportar con Chrome headless (el script incluye los tableros `-3` de administración):

```sh
sh docs/mockups/app-movil/fuentes/render.sh            # todos los tableros + variantes de tema (PNG 2x, 3680×2200)
sh docs/mockups/app-movil/fuentes/render.sh b-noche    # solo uno
```

- **Pantalla suelta:** abrir un tablero con `?solo=N` (N = posición del teléfono en ese tablero, 1 a 4; en los tableros `-3` corresponde a las pantallas 9 a 12)
  muestra solo ese teléfono. Así se generaron las imágenes de `pantallas/`, con ventana de 430×884 a 2x.
- **PDF:** salen de `fuentes/descripciones.html?d=a` (o `?d=b`) impreso con
  `chrome --headless --print-to-pdf --no-pdf-header-footer`. El texto de cada pantalla está en
  `fuentes/descripciones.js`.
- **Comprobar el PDF antes de imprimirlo:** `?check=1` marca las páginas desbordadas en
  `<body data-overflow>`, y `?only=N` muestra una sola página.

Las tipografías (Plus Jakarta Sans, Outfit, Fraunces/Inter) se cargan de Google Fonts; sin conexión, el
render cae a la fuente del sistema.
