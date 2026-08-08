# Fase 2 — Contrato cerrado de `/api/people` (padrón: import masivo + CRUD)

**Estado:** cerrado para implementar. Referencia obligatoria para `backend-developer` y `frontend-developer` trabajando en paralelo.
**Fecha:** 2026-08-07
**Alcance:** `POST /api/people/import`, `GET /api/people`, `POST /api/people`, `PATCH /api/people/:id`, `DELETE /api/people/:id`. Nada más. Sin `GET /api/people/:id` (no hace falta: la fila del listado ya trae todo lo editable).

Fuentes: `CLAUDE.md` §Personas, `docs/architecture/phase1-schema-design.md` (esquema `Person` ya migrado, D13 borrado lógico), y el código real de `server/src/**` y `client/src/**` al 2026-08-07.

Decisiones numeradas `P1…P20`. Lo que de verdad depende del usuario está aislado en §9.

---

## 0. Invariantes que esta fase debe proteger

| # | Invariante | Cómo se protege aquí |
|---|---|---|
| A1 | `category` decide el pool del sorteo de líderes (Fase 3) | Nunca se infiere ni se asigna por defecto: una fila sin categoría es **error**, no un `MINISTRO` silencioso (P6) |
| A2 | Un duplicado en el padrón infla el pool y desbalancea equipos | Deduplicación por documento normalizado y, en su defecto, por nombre normalizado (P7-P10) |
| A3 | Nunca se pierde historial de participación | `DELETE` = baja lógica por defecto; el borrado físico solo con `?purge=true` y **cero** membresías (P17-P18) |
| A4 | I3 de Fase 1: un `MINISTRO` solo es líder con override explícito | Degradar la categoría de alguien que hoy es `LEADER` marca `TeamMember.manualOverride = true` en la misma transacción (P16) |
| A5 | Dar de baja a alguien no lo saca de un mes ya armado | `DELETE`/`active=false` **no** toca `TeamMember`; solo devuelve un warning (P19) |

---

## 1. Formato del archivo de import

### P1 — Formatos aceptados
`.csv` (UTF-8, con o sin BOM) y `.xlsx`. **`.xls` legacy se rechaza** con mensaje explícito ("Guarda el archivo como .xlsx o .csv"). `accept=".csv,.xlsx"` del `FileUpload` ya existente es correcto y no cambia.

### P2 — Límites duros
- Tamaño máximo: **2 MB**.
- Filas de datos máximas: **2000**. Más que eso → 400 `DEMASIADAS_FILAS`.
- Un solo archivo por request, campo multipart **`file`** (ya es el nombre que usa `client/src/api/people.js`).

### P3 — Encabezado obligatorio
La primera fila no vacía es el encabezado. **No hay modo "sin encabezado"**: adivinar el orden de las columnas es la principal fuente de imports corruptos.

En XLSX se lee la hoja llamada `Personas` si existe; si no, la **primera** hoja.
En CSV el delimitador se autodetecta entre `,` y `;` (Excel en español exporta con `;` — omitir esto rompe el caso más común).

### P4 — Nombres de columna
El matching es **tolerante**: se normaliza el encabezado con `normalizeHeader()` (trim → minúsculas → quitar tildes → colapsar espacios/guiones bajos) y se compara contra estos alias.

| Columna canónica | Obligatoria | Alias aceptados (ya normalizados) |
|---|---|---|
| `fullName` | **Sí** | `nombre completo`, `nombre`, `nombres`, `nombre y apellido`, `nombres y apellidos`, `full name`, `fullname` |
| `category` | **Sí** | `categoria`, `categoría`, `tipo`, `rol`, `category` |
| `documentId` | No | `documento`, `documento de identidad`, `cedula`, `cédula`, `identificacion`, `identificación`, `cc`, `document`, `documentid` |
| `notes` | No | `notas`, `observaciones`, `comentarios`, `notes` |

- Falta `fullName` o `category` → **400** `COLUMNA_REQUERIDA_FALTANTE` (el archivo entero se rechaza; no tiene arreglo por fila).
- Columnas desconocidas se **ignoran** en silencio y se listan en `summary.ignoredColumns` para que la UI las muestre como aviso (detecta typos tipo "Categorias").
- Encabezado duplicado (dos columnas mapean a la misma canónica) → 400 `ENCABEZADO_AMBIGUO`.

### P5 — Valores aceptados en `category`
Se normaliza la celda (trim → mayúsculas → quitar tildes → colapsar espacios/guiones/guiones bajos) y se busca en esta tabla **cerrada**:

| Valor normalizado | Resultado |
|---|---|
| `INSTRUCTOR`, `INSTRUCTORES`, `ELEGIBLE LIDER`, `ELEGIBLE_LIDER`, `ELEGIBLE`, `ELEGIBLE A LIDER`, `LIDER`, `LIDERES`, `ELEGIBLE PARA LIDER` | `INSTRUCTOR` |
| `MINISTRO`, `MINISTRA`, `MINISTROS`, `COLABORADOR`, `COLABORADORA`, `COLABORADORES`, `COLAB`, `APOYO` | `MINISTRO` |

Cualquier otra cosa → error de fila `CATEGORIA_INVALIDA`. **Sin abreviaturas de una letra** (`I`/`M`): el riesgo de falso positivo supera la comodidad.

> `APOYO` mapea a `MINISTRO` a propósito: en el dominio, "apoyo" es un **rol dentro del equipo** que se asigna por sorteo a los `INSTRUCTOR` sobrantes (`TeamRole.SUPPORT`), no una categoría del padrón. Si alguien escribe "Apoyo" en el CSV está describiendo a un ministro. Los alias en español ("Elegible líder", "Colaborador", etc.) se conservan por compatibilidad hacia atrás con archivos viejos aunque el vocabulario vigente sea `INSTRUCTOR`/`MINISTRO`. Si esto resulta confuso en la práctica, quitar el alias es un cambio de una línea.

### P6 — Celda de categoría vacía
Error de fila `CATEGORIA_VACIA`. **Nunca** se aplica un valor por defecto (A1).

### P7 — Filas totalmente vacías
Se descartan antes de procesar, no cuentan como error, y se reportan solo como número en `summary.blankRowsIgnored`.

---

## 2. Normalización y deduplicación

### P8 — Funciones de normalización (idénticas en import y en CRUD individual)

```
normalizeName(s)      = s.trim().replace(/\s+/g, ' ')            // lo que se GUARDA en fullName
nameKey(s)            = normalizeName(s).toLocaleUpperCase('es')
                          .normalize('NFD').replace(/\p{M}/gu, '')  // solo para comparar
normalizeDocument(s)  = s.trim().toUpperCase().replace(/[\s.\-]/g, '')  // lo que se GUARDA en documentId
```

`documentId` se guarda **ya normalizado**: `1.234.567` y `1234567` son la misma persona y deben chocar contra el índice único `person_document_id_key`. Consecuencia visible para el frontend: `POST /api/people` con `"1.234.567"` devuelve `documentId: "1234567"`. Es intencional.

`nameKey` no se persiste; se calcula en memoria durante el import y con una consulta puntual en el alta individual. (Un día habrá volumen suficiente para justificar una columna `name_key` indexada; hoy con cientos de filas no lo hay.)

### P9 — Clave natural de deduplicación
1. Si la fila trae documento no vacío → la clave es `normalizeDocument(documento)`.
2. Si no → la clave es `nameKey(nombre)`.

**Justificación:** el documento es la única clave con respaldo en la base (`@unique`) y es estable ante cambios de nombre. El nombre normalizado es una heurística, pero `CLAUDE.md` define el documento como *opcional*, y el escenario realista de esta organización es un listado con muchos documentos vacíos; sin fallback por nombre, reimportar el mismo archivo duplicaría todo el padrón y rompería A2.

### P10 — Duplicados **dentro del mismo archivo**
Gana la **primera** aparición; las siguientes se reportan en `skipped` con `DUPLICADO_EN_ARCHIVO_DOCUMENTO` o `DUPLICADO_EN_ARCHIVO_NOMBRE`, indicando en el mensaje la fila que ganó. No se fusionan datos entre filas (fusionar sería adivinar cuál valor de categoría es el bueno).

### P11 — Duplicados **contra la base**

| Situación | Acción | Cuenta como |
|---|---|---|
| Coincide por **documento**, persona `active = true` | **Actualiza** `fullName` y `category` si el valor entrante es no vacío y distinto; actualiza `notes` solo si la columna vino y trae contenido (una celda vacía **nunca** borra notas existentes) | `updated` |
| Coincide por **documento**, sin ningún cambio | No escribe | `skipped` / `SIN_CAMBIOS` |
| Coincide por **documento**, persona `active = false` | **No** actualiza ni reactiva. Reporta con `personId` para que la UI ofrezca "reactivar" | `skipped` / `PERSONA_INACTIVA` |
| Coincide por **nombre** (la fila no trae documento, o lo trae y no existe en BD pero el nombre sí) | **No** actualiza. Reporta con `personId` | `skipped` / `NOMBRE_DUPLICADO_EN_BD` |
| No coincide con nada | **Crea** con `active = true` | `created` |

**Justificación del asimetría documento vs. nombre:** actualizar por documento es seguro (identidad verificada) y es lo que hace útil reimportar un padrón corregido. Actualizar por nombre no lo es: dos homónimos harían que un `INSTRUCTOR` real pase a `MINISTRO` silenciosamente y desaparezca del pool de líderes (A1/A2). Ante la duda, el import informa y el admin decide.

La reactivación automática se descarta por la misma razón: una baja es una decisión deliberada del admin, y reimportar el padrón completo no debe deshacerla sin que nadie lo note. El reporte deja el caso visible.

---

## 3. Manejo de errores y atomicidad del import

### P12 — Import parcial, siempre
Ninguna fila mala aborta el archivo. El servicio hace **dos pasadas**:
1. Parsea, valida y resuelve todas las filas en memoria (sin tocar la BD salvo la lectura de candidatos existentes).
2. Escribe el subconjunto válido dentro de **una** `prisma.$transaction([...])` (chunks de 500 operaciones, `timeout: 30000`).

Si la transacción falla (caso anómalo: carrera contra otro import), se devuelve **500** y **no se escribe nada**. Es decir: parcial respecto de *las filas del archivo*, atómico respecto de *la escritura*. Esto hace el resultado reproducible y testeable, y evita el estado "medio importado" imposible de reconciliar.

### P13 — Código de estado del import
- **200** siempre que el archivo se haya podido parsear, aunque **todas** las filas fallen. El reporte *es* la respuesta útil; un 400 obligaría al frontend a leer el detalle desde la rama de error.
- **400** solo si el archivo es inutilizable: `FORMATO_NO_SOPORTADO`, `ARCHIVO_VACIO`, `SIN_FILAS_DE_DATOS`, `COLUMNA_REQUERIDA_FALTANTE`, `ENCABEZADO_AMBIGUO`, `DEMASIADAS_FILAS`.
- **413** `ARCHIVO_MUY_GRANDE` (viene de multer, ver P20).

### P14 — Numeración de filas
`row` es el **número de fila tal como se ve en Excel / en el editor de texto**, 1-based, contando el encabezado. La primera fila de datos es normalmente `2`. No se usan índices 0-based en ninguna parte de la respuesta.

---

## 4. Endpoints

Todos bajo `requireAuth` (ya aplicado en `people.routes.js` con `router.use(requireAuth)`). Todos los errores usan el envelope existente de `errorHandler.js`:

```json
{ "error": { "message": "…", "details": … } }
```

`details` es `Array<{path, message}>` cuando viene de zod (`validate.js`), y `{ "code": "…", … }` cuando es un error de dominio lanzado a mano. El frontend debe ramificar por `details.code` cuando exista.

### DTO `Person` (idéntico en todas las respuestas)

```json
{
  "id": "clx…",
  "fullName": "María Fernanda Ruiz",
  "documentId": "1234567",
  "category": "INSTRUCTOR",
  "active": true,
  "notes": null,
  "createdAt": "2026-08-07T14:03:11.412Z",
  "updatedAt": "2026-08-07T14:03:11.412Z"
}
```

Nunca se devuelven campos adicionales. Nunca se devuelve `null` en lugar del objeto.

---

### P15 — `POST /api/people/import`

`Content-Type: multipart/form-data`, único campo **`file`**.

**200 →**

```json
{
  "fileName": "padron-agosto.xlsx",
  "summary": {
    "totalRows": 128,
    "created": 110,
    "updated": 6,
    "skipped": 7,
    "failed": 5,
    "blankRowsIgnored": 3,
    "ignoredColumns": ["Telefono"]
  },
  "created": [
    { "row": 2, "personId": "clx1…", "fullName": "María Fernanda Ruiz", "category": "INSTRUCTOR" }
  ],
  "updated": [
    { "row": 9, "personId": "clx2…", "fullName": "Juan Pérez",
      "changes": { "category": { "from": "MINISTRO", "to": "INSTRUCTOR" } } }
  ],
  "skipped": [
    { "row": 14, "code": "DUPLICADO_EN_ARCHIVO_DOCUMENTO", "personId": null,
      "message": "El documento 1234567 ya aparece en la fila 2 de este archivo." },
    { "row": 21, "code": "NOMBRE_DUPLICADO_EN_BD", "personId": "clx3…",
      "message": "Ya existe una persona registrada con el nombre «Ana Gómez». No se modificó." }
  ],
  "errors": [
    { "row": 33, "column": "Categoría", "value": "lider2", "code": "CATEGORIA_INVALIDA",
      "message": "«lider2» no es una categoría válida. Usa «Instructor» o «Ministro»." }
  ],
  "truncated": false
}
```

- `totalRows` = filas de datos consideradas = `created + updated + skipped + failed` (excluye `blankRowsIgnored`). Esta igualdad es un invariante testeable.
- Cada arreglo de detalle se **trunca a 200 elementos**; si se truncó alguno, `truncated: true`. Los contadores de `summary` siempre son exactos.
- `column` en `errors` es el **encabezado literal del archivo**, no el nombre canónico (así el admin lo encuentra a simple vista). `null` cuando el error no es de una columda concreta.

**Códigos de fila (`errors[].code`), lista cerrada:**
`NOMBRE_VACIO`, `NOMBRE_MUY_CORTO`, `NOMBRE_MUY_LARGO`, `NOMBRE_CARACTERES_INVALIDOS`, `CATEGORIA_VACIA`, `CATEGORIA_INVALIDA`, `DOCUMENTO_INVALIDO`, `DOCUMENTO_MUY_LARGO`, `NOTAS_MUY_LARGAS`.

**Códigos de omisión (`skipped[].code`), lista cerrada:**
`DUPLICADO_EN_ARCHIVO_DOCUMENTO`, `DUPLICADO_EN_ARCHIVO_NOMBRE`, `NOMBRE_DUPLICADO_EN_BD`, `PERSONA_INACTIVA`, `SIN_CAMBIOS`.

**400/413** → envelope de error con `details.code` de la lista de P13.

---

### `GET /api/people`

| Query param | Tipo | Default | Notas |
|---|---|---|---|
| `page` | int ≥ 1 | `1` | |
| `pageSize` | int 1..100 | `25` | |
| `search` | string 1..100 | — | `contains` case-insensitive sobre `fullName` **o** `documentId` (OR). El término se normaliza con `normalizeDocument` para la parte de documento, de modo que buscar `1.234` encuentre `1234`. |
| `category` | `INSTRUCTOR` \| `MINISTRO` | — | |
| `active` | `"true"` \| `"false"` | — | **Sin filtro por defecto: devuelve activos e inactivos.** |
| `sort` | `fullName` \| `-fullName` \| `createdAt` \| `-createdAt` | `fullName` | |

> Acuerdo explícito para que ambos agentes no elijan distinto: la API es neutral en `active`, y **`PeopleManager` arranca enviando `active=true`** con un toggle "Ver inactivos" que lo quita.

**200 →**

```json
{
  "data": [ /* Person[] */ ],
  "pagination": { "page": 1, "pageSize": 25, "total": 137, "totalPages": 6 }
}
```

`total` sale de un `prisma.$transaction([findMany, count])` con el mismo `where`. Página fuera de rango devuelve `data: []` con la paginación real (no 404).

Limitación conocida y aceptada: el orden y la búsqueda dependen de la collation de Postgres, así que las tildes no son transparentes (`search=angela` no encuentra `Ángela`). Con un padrón de cientos de filas es tolerable; la salida futura es una columna `name_key` normalizada e indexada (mismo `nameKey()` de P8), sin cambiar este contrato.

---

### `POST /api/people`

```json
{ "fullName": "Ana Gómez", "documentId": "1.234.567", "category": "MINISTRO",
  "notes": null, "confirmDuplicateName": false }
```

- `documentId`, `notes` y `confirmDuplicateName` son opcionales. **No** se acepta `active`: toda persona nueva nace activa.
- **201** → DTO `Person`.
- **400** validación zod (§5).
- **409** `DOCUMENTO_DUPLICADO` → `details: { code: "DOCUMENTO_DUPLICADO", personId, fullName }`.
- **409** `NOMBRE_DUPLICADO` si ya existe una persona con el mismo `nameKey` **y** el body no trae `confirmDuplicateName: true` → `details: { code: "NOMBRE_DUPLICADO", personId, fullName }`.

**Justificación de `confirmDuplicateName`:** los homónimos reales existen y bloquearlos con un 409 duro sería incorrecto, pero crearlos en silencio es la vía más probable de contaminar el pool del sorteo (A2). Un 409 recuperable convierte el problema en un diálogo de la UI ("Ya existe «Ana Gómez». ¿Crear de todos modos?") y deja la decisión registrada en la intención del admin.

---

### `PATCH /api/people/:id`

Body con **al menos una** de: `fullName`, `documentId` (`string | null`, `null` la borra), `category`, `notes` (`string | null`), `active`. Body vacío → **400** `SIN_CAMBIOS`.

`active` se acepta aquí a propósito: es el **único** camino para reactivar a alguien dado de baja (y el que resuelve el caso `PERSONA_INACTIVA` del import).

**200 →**

```json
{ "person": { /* Person */ }, "warnings": [ { "code": "…", "message": "…" } ] }
```

> Ojo, `frontend-developer`: `PATCH` y `DELETE` devuelven `{ person, warnings }`, **no** el `Person` pelado. `POST` y `GET` sí devuelven el DTO directo / envelope de lista. Es deliberado: solo estas dos operaciones pueden tener efectos colaterales que el admin necesita ver.

- **404** si el id no existe.
- **409** `DOCUMENTO_DUPLICADO` (mismo shape que en `POST`). Cambiar el nombre **no** dispara 409 aquí (renombrar no es crear).

### P16 — Efecto colateral obligatorio al degradar categoría (invariante A4)
Si el cambio es `INSTRUCTOR → MINISTRO` y esa persona tiene alguna fila `TeamMember` con `role = 'LEADER'`, en **la misma transacción** se marca `manualOverride = true` en esas filas, y se devuelve:

```json
{ "code": "LIDER_DEGRADADO_A_MINISTRO",
  "message": "Esta persona lidera 1 equipo (Agosto 2026). Su liderazgo quedó marcado como excepción manual." }
```

Hoy es un no-op (no existe todavía ningún `TeamMember`), pero **debe implementarse ahora**: es la única forma de que I3 de Fase 1 siga siendo cierta después de una edición del padrón, y descubrirlo en Fase 3 implicaría datos ya corruptos. Se prohíbe la alternativa de bloquear con 409: el admin tiene la última palabra sobre el padrón.

### P19 — Warning al dar de baja
Poner `active = false` (por `PATCH` o por `DELETE`) **no toca `TeamMember`** (A5, D13 de Fase 1). Si la persona pertenece a algún mes con status `DRAFT` o `FINALIZED`, se devuelve:

```json
{ "code": "PERSONA_EN_EQUIPO_ACTIVO",
  "message": "Sigue asignada a Equipo 3 (Agosto 2026). La baja solo la excluye de los sorteos futuros." }
```

---

### `DELETE /api/people/:id`

### P17 — Baja lógica por defecto
Sin query params: `active = false`. **200** con `{ person, warnings }` igual que `PATCH`. Es **idempotente**: borrar a alguien ya inactivo devuelve 200 con el mismo cuerpo, nunca 404 ni 409. **404** solo si el id no existe.

**Justificación de mantener siempre la baja lógica como comportamiento por defecto, incluso para quien nunca participó:** (a) un solo camino y un solo significado de `DELETE`, sin que el frontend tenga que preguntar antes si la persona "se puede borrar de verdad"; (b) las FK `Restrict` desde `TeamMember`/`SpecialSaturdayMember` harían fallar un borrado físico en runtime, y el chequeo previo es TOCTOU-inseguro fuera de transacción; (c) el historial es exactamente el insumo del futuro reporte de asistencia por líderes.

### P18 — Escape hatch: `DELETE /api/people/:id?purge=true`
Borra físicamente **solo si**, dentro de una transacción, la persona tiene **cero** filas en `TeamMember` y **cero** en `SpecialSaturdayMember`. Si no, **409** `PERSONA_CON_HISTORIAL` con `details: { code, teamMemberships, specialEventRoles }`.

**Por qué existe:** esta es precisamente la fase donde entra la carga masiva, y un import de prueba equivocado deja cientos de filas basura que el borrado lógico no limpia (quedarían para siempre en el listado con el filtro de inactivos). Sin este escape la única salida sería tocar la base a mano en producción. La precondición dura y la transacción preservan A3 sin excepciones.

Respuesta: **200** `{ "deleted": true, "id": "clx…" }`. La UI debe pedir confirmación explícita (`ConfirmDialog`) con texto distinto al de la baja lógica.

---

## 5. Esquemas zod (`server/src/routes/people.routes.js`)

Reglas exactas — las mismas se aplican al validar cada fila del import, para que un dato aceptado por el CSV nunca sea rechazado por el CRUD ni al revés.

```js
const fullName = z.string()
  .transform((s) => s.trim().replace(/\s+/g, " "))
  .pipe(
    z.string()
      .min(3,  "El nombre debe tener al menos 3 caracteres")
      .max(120,"El nombre no puede superar 120 caracteres")
      .regex(/^\p{L}[\p{L}\p{M}\s'.\-]*$/u,
        "El nombre solo admite letras, espacios, apóstrofos, guiones y puntos")
  );

const documentId = z.string()
  .transform((s) => s.trim().toUpperCase().replace(/[\s.\-]/g, ""))
  .pipe(
    z.string()
      .min(3,  "El documento debe tener al menos 3 caracteres")
      .max(30, "El documento no puede superar 30 caracteres")
      .regex(/^[A-Z0-9]+$/, "El documento solo admite letras y números")
  );

const category = z.enum(["INSTRUCTOR", "MINISTRO"]);   // sin alias: los alias
                                                              // son cosa del parser del import
const notes = z.string().trim().max(500).nullish();
const idParam = z.object({ id: z.string().min(1).max(40) });   // formato de cuid NO se valida;
                                                               // id inexistente => 404
```

Notas de implementación no negociables:
- El **regex del nombre rechaza dígitos** a propósito: es lo que detecta filas basura y encabezados repetidos en medio del archivo.
- `documentId` en `POST`/`PATCH` es `.nullish()`; una cadena vacía `""` se normaliza a `null`, no se guarda como `""` (un `""` rompería el índice único a la segunda persona sin documento).
- Query: `z.coerce.number().int()` para `page`/`pageSize`; `active` llega como string y se transforma a booleano. Esto funciona porque `validate.js` reasigna `req.query` — válido en Express 4.22, **se rompería en Express 5** (ahí `req.query` es getter). Anotarlo si algún día se sube de major.

### P20 — Middleware de subida
`multer` en `memoryStorage` (nunca disco: el archivo cabe en RAM y evita limpiar temporales), `limits: { fileSize: 2 * 1024 * 1024, files: 1 }`, `fileFilter` por extensión **y** mimetype.

`MulterError` **no** lo maneja `errorHandler.js` hoy (solo reconoce `AppError` y errores Prisma `P*`), así que caería como 500. El router debe envolver el middleware y traducir: `LIMIT_FILE_SIZE → HttpError(413, …, { code: "ARCHIVO_MUY_GRANDE" })`, `LIMIT_FILE_COUNT`/`LIMIT_UNEXPECTED_FILE → ValidationError`.

**Dependencias nuevas en `/server`:** `multer@^2`, `papaparse` (CSV: comillas, BOM y delimitador), `exceljs` (XLSX).
Se descarta `xlsx` (SheetJS): la versión publicada en el registro npm está congelada y arrastra un aviso de prototype pollution; las correcciones solo se distribuyen por el CDN propio del proyecto. `exceljs` está mantenido, es MIT y está en npm. Alternativa mínima considerada y descartada: soportar solo CSV y cero dependencias de Excel — `CLAUDE.md` dice explícitamente "CSV/Excel", y pedirle a un admin no técnico que convierta el archivo garantiza errores de codificación.

---

## 6. Tabla resumen de códigos de estado

| Endpoint | OK | Errores |
|---|---|---|
| `POST /people/import` | 200 (siempre que parsee) | 400 archivo inutilizable, 413 muy grande, 401 sin token |
| `GET /people` | 200 | 400 query inválida, 401 |
| `POST /people` | 201 | 400, 409 `DOCUMENTO_DUPLICADO` / `NOMBRE_DUPLICADO`, 401 |
| `PATCH /people/:id` | 200 | 400 (incl. body vacío), 404, 409 `DOCUMENTO_DUPLICADO`, 401 |
| `DELETE /people/:id` | 200 | 404, 401 |
| `DELETE /people/:id?purge=true` | 200 | 404, 409 `PERSONA_CON_HISTORIAL`, 401 |

---

## 7. Discrepancias con el código actual que hay que corregir en esta fase

Verificado contra el repo, no son hipótesis:

1. **`client/src/api/client.js` línea 70 no lee el mensaje del servidor.** Hace `payload?.message`, pero `errorHandler.js` responde `{ error: { message } }`. Hoy todo error del servidor se muestra como "Error 4xx al comunicarse con el servidor". Debe pasar a `payload?.error?.message ?? payload?.message`, y `details: payload?.error?.details ?? null`. Sin este arreglo, los 409 `DOCUMENTO_DUPLICADO`/`NOMBRE_DUPLICADO` son invisibles para el admin y el flujo de `confirmDuplicateName` no se puede construir. **Dueño: `frontend-developer`, primero de la lista.**
2. **`client/src/api/people.js#getPeople`** no acepta filtros y su JSDoc promete un array pelado. Debe aceptar `(params)` y serializar el querystring; el envelope pasa a ser `{ data, pagination }`.
3. **`client/src/pages/PeopleManager.jsx` línea 76** hace `data={data || []}`; con el envelope pasa a `data?.data ?? []`. La página completa (búsqueda, filtros, paginación, alta, edición, baja, import con reporte) es trabajo de Fase 2, no un ajuste.
4. **`server/src/routes/people.routes.js` no tiene ruta `DELETE`** (el stub solo trae `GET`, `POST`, `POST /import`, `PATCH`), pero `client/src/api/people.js#deactivatePerson` ya la llama. Hay que agregarla.
5. **No existe `server/src/services/importPeople.service.js`**, aunque `phase1-schema-design.md` §4 lo lista. Se crea en esta fase. Recordatorio de la regla de capas: `people.routes.js` solo parsea/valida/serializa; toda la lógica va en `services/` (`importPeople.service.js` y un `people.service.js` nuevo para el CRUD).
6. **`multer`/`papaparse`/`exceljs` no están en `server/package.json`.**

---

## 8. Cobertura mínima de pruebas que cierra esta fase

Backend (vitest + supertest, siguiendo el patrón de `server/tests/*.test.js`): import con archivo mixto (válidas + inválidas + duplicadas intra-archivo + duplicada contra BD) verificando que `created + updated + skipped + failed === totalRows`; CSV con `;` y con BOM; XLSX; falta de columna obligatoria → 400; alias de categoría; `1.234.567` y `1234567` colisionan; `POST` duplicado → 409 y luego 201 con `confirmDuplicateName`; `PATCH` con body vacío → 400; `DELETE` idempotente; `?purge=true` con historial → 409. La regresión de P16 (`manualOverride`) queda cubierta en Fase 3, cuando existan `TeamMember`.

---

## 9. Requiere confirmación del usuario

No bloquean la implementación — todos tienen una decisión tomada y funcionando; son puntos donde una preferencia distinta del usuario cambiaría el comportamiento:

1. **El import no reactiva a nadie automáticamente** (P11, caso `PERSONA_INACTIVA`). Alternativa: reactivar si el documento coincide. Si el flujo real es "cada mes reimporto la lista completa de quienes participan", la reactivación automática sería más cómoda; hoy prima no deshacer bajas en silencio.
2. **`APOYO` mapea a `MINISTRO`** en la columna de categoría (P5). Confirmar que en el vocabulario del usuario "apoyo" no es una tercera categoría del padrón — el esquema solo admite dos.
3. **Existencia del borrado físico `?purge=true`** (P18). Si se prefiere prohibirlo por completo, se elimina sin tocar el resto del contrato.
4. **Tope de 2000 filas y 2 MB** (P2). Fijado por criterio; si el padrón real es de decenas de personas sobra, y si algún día son miles hay que revisar (y pasar a parseo en streaming).
