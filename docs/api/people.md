# API — Personas (`/api/people`)

Referencia de la API tal como quedó implementada al cierre de la **Fase 2**. Es la
fuente de verdad de *comportamiento HTTP*; el porqué de cada decisión de diseño
(justificaciones, alternativas descartadas, invariantes de negocio) vive en
[`docs/architecture/phase2-people-contract.md`](../architecture/phase2-people-contract.md)
y no se repite aquí — este documento solo describe lo que el código hace.

Verificado línea por línea contra:
`server/src/routes/people.routes.js`, `server/src/services/people.service.js`,
`server/src/services/importPeople.service.js`, `server/src/utils/normalize.js`,
`server/src/middleware/{auth,validate,errorHandler}.js`, y las pruebas de integración
`server/tests/people.crud.test.js` / `server/tests/people.import.test.js` (corridas contra
el servidor real, no mockeado).

## Autenticación

**Todos** los endpoints de este recurso requieren autenticación (`router.use(requireAuth)`
en `people.routes.js`). No hay ningún endpoint público bajo `/api/people`.

Envía el JWT obtenido en `POST /api/auth/login` (ver [`README.md`](../../README.md#8-confirmar-que-todo-quedó-funcionando))
en cada request:

```
Authorization: Bearer <jwt>
```

| Situación | Status | Body |
|---|---|---|
| Falta el header o no empieza con `Bearer ` | 401 | `{ "error": { "message": "Falta el token de autenticación." } }` |
| Token inválido, mal firmado o expirado | 401 | `{ "error": { "message": "Token inválido o expirado." } }` |

Ninguna de las dos respuestas 401 trae `details`.

## Envelope de errores

Todos los errores (de cualquier endpoint de este recurso) usan el mismo formato:

```json
{ "error": { "message": "…", "details": … } }
```

- `details` es **ausente** si el error no tiene detalle estructurado.
- `details` es `Array<{ path: string, message: string }>` cuando el error viene de
  validación zod (un elemento por campo inválido; `path` incluye el prefijo `body.`,
  `query.` o `params.`).
- `details` es `{ code: "…", ... }` (objeto, no array) cuando es un error de dominio
  lanzado a mano por `people.service.js` o `importPeople.service.js`. El código del
  catálogo (sección más abajo) siempre está en `details.code`.

El frontend debe ramificar por `Array.isArray(details)` vs. `details.code` para saber
qué tipo de error recibió.

## DTO `Person`

Forma idéntica en toda respuesta que devuelva una persona (dentro de `data[]` en el
listado, como cuerpo directo en `POST`, dentro de `{ person }` en `PATCH`/`DELETE`):

```json
{
  "id": "clx1a2b3c",
  "fullName": "María Fernanda Ruiz",
  "documentId": "1234567",
  "category": "INSTRUCTOR",
  "isJoven": false,
  "isAdultoMayor": false,
  "active": true,
  "notes": null,
  "createdAt": "2026-08-07T14:03:11.412Z",
  "updatedAt": "2026-08-07T14:03:11.412Z"
}
```

No se devuelven campos adicionales ni `null` en lugar del objeto.

> `isJoven` (Fase "equipo de jóvenes") es **independiente** de `category`: una
> persona puede ser `INSTRUCTOR` o `MINISTRO` y, a la vez, pertenecer (o no) al
> pool de sorteo del equipo de jóvenes. No lo reemplaza ni lo condiciona.

> `isAdultoMayor` (2026-08-22) es, igual que `isJoven`, **independiente** de
> `category`: repartido equitativamente en el sorteo mensual (mismo mecanismo que
> apoyo/colaboradores), sin importar quién puede ser líder. **Mutuamente excluyente
> con `isJoven`**: nunca ambos `true` a la vez — protegido con un `CHECK` a nivel de
> base de datos y, en el servidor, con auto-limpieza (`PATCH`, ver más abajo) y
> rechazo explícito (`POST`/`PATCH` con ambos `true` a la vez → 400).

---

## `GET /api/people`

Lista paginada con búsqueda y filtros.

### Query params

| Param | Tipo | Default | Reglas |
|---|---|---|---|
| `page` | entero | `1` | `>= 1`. Página fuera de rango devuelve `data: []`, **no 404**. |
| `pageSize` | entero | `25` | `1..100`. |
| `search` | string | — | `1..100` caracteres. `contains` case-insensitive sobre `fullName` **o** `documentId` (OR). Para la parte de documento, el término de búsqueda se normaliza con la misma función `normalizeDocument()` que al guardar, así que `search=1.234` encuentra a alguien con `documentId: "1234"`. |
| `category` | `INSTRUCTOR` \| `MINISTRO` | — | |
| `active` | `"true"` \| `"false"` | *(sin filtro)* | **La API es neutral: sin este param devuelve activos e inactivos juntos.** La pantalla `PeopleManager` del frontend envía `active=true` por defecto y tiene un toggle "Ver inactivos" que lo quita — ese default es una decisión de UI, no de la API. |
| `isJoven` | `"true"` \| `"false"` | *(sin filtro)* | Filtra por elegibilidad para el equipo de jóvenes, independiente de `category`. Sin este param devuelve personas `isJoven: true` e `isJoven: false` juntas. |
| `isAdultoMayor` | `"true"` \| `"false"` | *(sin filtro)* | Filtra por el pool de adulto mayor, independiente de `category`. Sin este param devuelve personas `isAdultoMayor: true` e `isAdultoMayor: false` juntas. |
| `sort` | `fullName` \| `-fullName` \| `createdAt` \| `-createdAt` | `fullName` | |

Cualquier valor fuera de estas reglas (`page=0`, `active=si`, `sort=nombre`, etc.) → **400**
con `details` en formato array (zod).

### 200 →

```json
{
  "data": [ /* Person[] */ ],
  "pagination": { "page": 1, "pageSize": 25, "total": 137, "totalPages": 6 }
}
```

`pagination.total` sale de `prisma.$transaction([findMany, count])` con el mismo `where`,
así que siempre es consistente con `data`.

**Limitación conocida (no es un bug):** el orden y la búsqueda dependen de la collation
de PostgreSQL, así que las tildes no son transparentes — `search=angela` no encuentra
`Ángela`. Tolerable con un padrón de cientos de filas.

---

## `POST /api/people`

Crea una persona nueva. Toda persona nace `active: true`; el body **no** acepta `active`.

### Body

```json
{
  "fullName": "Ana Gómez",
  "documentId": "1.234.567",
  "category": "MINISTRO",
  "isJoven": false,
  "isAdultoMayor": false,
  "notes": null,
  "confirmDuplicateName": false
}
```

| Campo | Obligatorio | Reglas |
|---|---|---|
| `fullName` | Sí | Se normaliza (`trim` + colapsar espacios internos) antes de validar. `3..120` caracteres. Regex `^\p{L}[\p{L}\p{M}\s'.-]*$` — **rechaza dígitos** a propósito (detecta filas basura / errores de captura). |
| `documentId` | No | `string \| null`. `""` o `null` se guardan como `null` (nunca `""`, para no romper el índice único con la segunda persona sin documento). Si trae valor: se normaliza (`trim` + mayúsculas + quitar espacios/puntos/guiones) y valida `3..30` caracteres, solo `[A-Z0-9]`. `"1.234.567"` se guarda como `"1234567"`. |
| `category` | Sí | Enum exacto `INSTRUCTOR` \| `MINISTRO`. Sin alias aquí (los alias de texto libre son solo del import). |
| `isJoven` | No | `boolean`, default `false`. Independiente de `category` (ver nota en el DTO arriba). |
| `isAdultoMayor` | No | `boolean`, default `false`. Independiente de `category`. **Mutuamente excluyente con `isJoven`**: si el body manda ambos en `true` a la vez → 400 (`details` array, `path` termina en `isAdultoMayor`). |
| `notes` | No | `string \| null`, máx. 500 caracteres. |
| `confirmDuplicateName` | No | `boolean`, default `false`. Ver 409 `NOMBRE_DUPLICADO` abajo. |

### Respuestas

- **201** → DTO `Person`.
- **400** → validación zod, `details` es array. Incluye el caso `isJoven: true` +
  `isAdultoMayor: true` a la vez en el mismo body.
- **409** `DOCUMENTO_DUPLICADO` → ya existe una persona (cualquier estado, activa o
  inactiva) con el mismo `documentId` normalizado.
  ```json
  { "error": { "message": "Ya existe una persona registrada con este documento.",
    "details": { "code": "DOCUMENTO_DUPLICADO", "personId": "clx9…", "fullName": "Ana Gómez" } } }
  ```
  Este código está garantizado incluso bajo carrera: dos `POST` concurrentes con el
  mismo `documentId` nuevo siempre producen un 201 y un 409 estructurado (nunca dos 409
  genéricos ni un 500) — cubierto por una prueba de integración dedicada
  (`server/tests/people.crud.test.js`, caso "carrera").
- **409** `NOMBRE_DUPLICADO` → ya existe una persona con el mismo nombre normalizado
  (`nameKey`: mayúsculas sin tildes) y el body no trae `confirmDuplicateName: true`.
  ```json
  { "error": { "message": "Ya existe una persona registrada con el nombre «Ana Gómez».",
    "details": { "code": "NOMBRE_DUPLICADO", "personId": "clx7…", "fullName": "Ana Gómez" } } }
  ```
  Reenviar el mismo body con `"confirmDuplicateName": true"` crea la persona igual
  (201): homónimos reales existen y no deben quedar bloqueados, pero crearlos en
  silencio contaminaría el pool de sorteo de líderes, así que la API exige una
  confirmación explícita.

---

## `PATCH /api/people/:id`

Edita una persona existente. **También** es el único camino para reactivar a alguien
dado de baja (`active: true`).

### Body

Al menos uno de: `fullName`, `documentId` (`string | null`; `null` la borra),
`category`, `isJoven` (`boolean`), `isAdultoMayor` (`boolean`), `notes` (`string | null`),
`active` (`boolean`). Mismas reglas de formato que en `POST` para cada campo.

Body vacío (o con solo claves `undefined`) → **400**:
```json
{ "error": { "message": "El cuerpo debe incluir al menos un campo para actualizar.",
  "details": { "code": "SIN_CAMBIOS" } } }
```
> Ojo: este `SIN_CAMBIOS` (400, "no mandaste nada que cambiar") es un código distinto
> en significado del `SIN_CAMBIOS` que aparece en `skipped[].code` del import (200,
> "esta fila coincide con alguien que ya tenía exactamente estos datos"). Mismo nombre,
> dos contextos — no los confundas al hacer manejo de errores en el cliente.

Si el body manda `isJoven: true` y `isAdultoMayor: true` explícitos a la vez → **400**
(`details` array, `path` termina en `isAdultoMayor`) — error real del cliente, no se
auto-resuelve. En cambio, si el body manda solo uno de los dos en `true` y la persona ya
tenía el otro en `true`, el servidor lo **auto-limpia**: el campo contrario queda en
`false` sin que haga falta mandarlo explícito (así, marcar "Adulto mayor" en la interfaz
estando "Joven" activo desmarca "Joven" solo, y viceversa).

### Respuesta de éxito

**200**, con un shape distinto al de `POST`/`GET`:

```json
{
  "person": { /* Person */ },
  "warnings": [ { "code": "…", "message": "…" } ]
}
```

`warnings` siempre está presente (puede ser `[]`). Puede traer, según lo que dispare el
cambio:

- `LIDER_DEGRADADO_A_MINISTRO` — si `category` pasa de `INSTRUCTOR` a
  `MINISTRO` y esa persona lidera (`TeamMember.role = 'LEADER'`) algún equipo. En la
  misma transacción se marca `manualOverride = true` en esas filas.
  ```json
  { "code": "LIDER_DEGRADADO_A_MINISTRO",
    "message": "Esta persona lidera 1 equipo (Agosto 2026). Su liderazgo quedó marcado como excepción manual." }
  ```
- `PERSONA_EN_EQUIPO_ACTIVO` — si `active` pasa a `false` y la persona pertenece a
  algún equipo de un mes en estado `DRAFT` o `FINALIZED`. Informativo: la baja **no**
  la saca de ese equipo.
  ```json
  { "code": "PERSONA_EN_EQUIPO_ACTIVO",
    "message": "Sigue asignada a Equipo 3 (Agosto 2026). La baja solo la excluye de los sorteos futuros." }
  ```

### Otros errores

- **404** si `id` no existe. (El formato del `id` no se valida contra el patrón de
  cuid; cualquier string de 1 a 40 caracteres que no exista en la base cae en 404.)
- **409** `DOCUMENTO_DUPLICADO` (mismo shape que en `POST`) si `documentId` cambia a un
  valor que ya tiene otra persona. Cambiar solo `fullName` a un nombre que ya existe
  **no** dispara ningún 409 en `PATCH` (renombrar no es crear).

---

## `DELETE /api/people/:id`

### Sin query params — baja lógica (comportamiento por defecto)

Pone `active = false`. **200** con el mismo shape `{ person, warnings }` que `PATCH`
(mismos posibles `warnings`, típicamente `PERSONA_EN_EQUIPO_ACTIVO`).

**Idempotente**: borrar a alguien ya inactivo devuelve **200** con el mismo cuerpo, no
404 ni 409. **404** solo si el `id` no existe en absoluto.

No toca ninguna fila de `TeamMember`: a alguien dado de baja no se le quita de un
equipo ya armado, solo se lo excluye de sorteos futuros.

### `?purge=true` — borrado físico (escape hatch)

```
DELETE /api/people/:id?purge=true
```

Borra la fila de `Person` de verdad, **solo si**, dentro de una transacción, la persona
tiene **cero** filas en `TeamMember` y **cero** en `SpecialSaturdayMember`.

- **200** → `{ "deleted": true, "id": "clx…" }`
- **409** `PERSONA_CON_HISTORIAL` si tiene alguna fila de historial:
  ```json
  { "error": { "message": "No se puede borrar físicamente: la persona tiene historial de participación.",
    "details": { "code": "PERSONA_CON_HISTORIAL", "teamMemberships": 2, "specialEventRoles": 0 } } }
  ```
- **404** si el `id` no existe.

`purge` acepta literalmente `"true"` o `"false"` como string en el query; cualquier otro
valor → 400 de validación. Omitir el param equivale a `"false"`.

---

## `POST /api/people/import`

Carga masiva desde un archivo `.csv` o `.xlsx`. `Content-Type: multipart/form-data`,
campo único **`file`**.

### Formato de archivo aceptado

| Regla | Detalle |
|---|---|
| Extensiones | `.csv` y `.xlsx`. `.xls` (Excel legacy) se **rechaza explícitamente**, distinto del resto de formatos no soportados: `400 FORMATO_NO_SOPORTADO` con mensaje "El formato .xls no es compatible. Guarda el archivo como .xlsx o .csv." El servidor también valida el `Content-Type` (mimetype) que envía el navegador junto con la extensión; un mimetype fuera de la lista tolerada (variantes conocidas de CSV/XLSX/texto plano) produce el mismo `400 FORMATO_NO_SOPORTADO`, aunque en la práctica esto casi nunca ocurre con un archivo `.csv`/`.xlsx` real subido desde un navegador. |
| Tamaño máximo | 2 MB. Por encima → `413 ARCHIVO_MUY_GRANDE` (lo detecta `multer` antes de que el archivo llegue al parser). |
| Filas de datos máximas | 2000 (sin contar encabezado ni filas vacías). Por encima → `400 DEMASIADAS_FILAS`. |
| Archivos por request | Uno solo, en el campo `file`. Otro nombre de campo o más de un archivo → `400 ARCHIVO_INVALIDO` ("Se espera un único archivo en el campo 'file'."). Este código no está en la lista cerrada de la sección 4 del contrato de diseño — es un caso de borde real de `multer` (`LIMIT_FILE_COUNT`/`LIMIT_UNEXPECTED_FILE`) que el router traduce a mano; queda documentado aquí porque es comportamiento real observable, aunque sea infrecuente en el flujo normal de la UI. |
| Hoja de cálculo (XLSX) | Se lee la hoja llamada `Personas` si existe (comparación insensible a mayúsculas/tildes); si no, la primera hoja del libro. |
| Delimitador (CSV) | Se autodetecta entre `,` y `;` (Excel en español exporta con `;`). |
| Codificación / BOM | UTF-8, con o sin BOM — el BOM se recorta antes de parsear. |
| Encabezado | La primera fila no vacía del archivo. No hay modo "sin encabezado": el orden de columnas nunca se adivina. |

### Columnas y alias

El encabezado se normaliza (`trim` → minúsculas → sin tildes → espacios/guiones/guiones
bajos colapsados a un solo espacio) y se compara contra esta tabla:

| Columna canónica | Obligatoria | Alias reconocidos |
|---|---|---|
| `fullName` | **Sí** | `nombre completo`, `nombre`, `nombres`, `nombre y apellido`, `nombres y apellidos`, `full name`, `fullname` |
| `category` | **Sí** | `categoria`, `categoría`, `tipo`, `rol`, `category` |
| `documentId` | No | `documento`, `documento de identidad`, `cedula`, `cédula`, `identificacion`, `identificación`, `cc`, `document`, `documentid` |
| `notes` | No | `notas`, `observaciones`, `comentarios`, `notes` |
| `isJoven` | No | `joven`, `jovenes`, `jóvenes`, `es joven` |
| `isAdultoMayor` | No | `adulto mayor`, `adultos mayores`, `es adulto mayor`, `tercera edad` |

- Falta `fullName` o `category` → **400** `COLUMNA_REQUERIDA_FALTANTE` (`details.missing`
  lista cuáles). El archivo entero se rechaza.
- Dos columnas mapean a la misma canónica (p. ej. "Nombre" y "Nombres" juntas) → **400**
  `ENCABEZADO_AMBIGUO` (`details.fields` lista las canónicas en conflicto).
- Columnas no reconocidas se ignoran en silencio y se listan en
  `summary.ignoredColumns` (para que la UI avise de posibles typos, ej. "Categorias").

### Valores aceptados en `category`

La celda se normaliza (`trim` → mayúsculas → sin tildes → espacios/guiones colapsados)
y se busca en esta tabla cerrada:

| Valor normalizado de la celda | Se guarda como |
|---|---|
| `INSTRUCTOR`, `INSTRUCTORES`, `ELEGIBLE LIDER`, `ELEGIBLE`, `ELEGIBLE A LIDER`, `LIDER`, `LIDERES`, `ELEGIBLE PARA LIDER` | `INSTRUCTOR` |
| `MINISTRO`, `MINISTRA`, `MINISTROS`, `COLABORADOR`, `COLABORADORA`, `COLABORADORES`, `COLAB`, `APOYO` | `MINISTRO` |

No hay abreviaturas de una letra (`I`/`M`). Cualquier otro texto → error de fila
`CATEGORIA_INVALIDA`. Celda vacía (columna presente, sin valor) → `CATEGORIA_VACIA`;
**nunca** se asigna una categoría por defecto.

> Los alias en español ("Elegible líder", "Colaborador", etc.) se conservan a propósito
> por compatibilidad hacia atrás con archivos viejos, aunque el vocabulario vigente sea
> `INSTRUCTOR`/`MINISTRO`. `APOYO` mapea a `MINISTRO`: en el dominio, "apoyo" es un rol
> dentro del equipo que se asigna por sorteo (Fase 3), no una categoría del padrón.

### Valores aceptados en la columna opcional `Joven`

Columna **opcional**, independiente de `category`. La celda se normaliza igual que la
de categoría (`trim` → mayúsculas → sin tildes) y se compara contra una tabla cerrada de
valores afirmativos:

| Valor normalizado de la celda | `isJoven` |
|---|---|
| `SI`, `TRUE`, `1`, `X` (cubre `"Sí"`, `"sí"`, `"si"` una vez sin tilde) | `true` |
| Cualquier otro valor (`"No"`, `"false"`, `"0"`, vacío, texto libre) | `false` |

A diferencia de `category`, esta columna **nunca produce un error de fila**: cualquier
valor no reconocido como afirmativo se interpreta como `false`, nunca bloquea la fila.
Si la columna no está presente en el archivo, `isJoven` queda `false` para **todas** las
filas que se crean; si la fila corresponde a alguien que ya existe (actualización por
documento), la ausencia de la columna **no toca** su `isJoven` actual (mismo criterio que
`notes`: solo se actualiza si el archivo trae la columna).

### Valores aceptados en la columna opcional `Adulto mayor` (2026-08-22)

Mismo tratamiento exacto que la columna `Joven` (misma tabla de valores afirmativos,
mismo criterio de "no toca lo existente si la columna no vino en el archivo"), en un
campo independiente: `isAdultoMayor`.

**Conflicto en la misma fila**: si una fila trae **ambas** columnas ("Joven" y "Adulto
mayor") con un valor afirmativo a la vez, el import **no rechaza la fila** (se perdería
nombre/categoría/documento válidos). En cambio, deja `isJoven` e `isAdultoMayor` en
`false` para esa fila puntual (ninguno de los dos gana, no se adivina cuál "vale más") y
agrega una nota al reporte de esa fila (`notes: [{ code: "JOVEN_ADULTO_MAYOR_CONFLICTO_EN_FILA", message: "…" }]`,
mismo mecanismo que `changes` en `updated[]`) — la fila sigue contando como `created` o
`updated` normalmente, nunca se mueve a `errors` ni a `skipped` por este motivo.

### 200 → reporte de import

El endpoint responde **200** siempre que el archivo se haya podido parsear, incluso si
**todas** las filas fallaron — el reporte es la respuesta útil, no hace falta leer una
rama de error para ver qué pasó.

```json
{
  "fileName": "padron-agosto.xlsx",
  "summary": {
    "totalRows": 8,
    "created": 2,
    "updated": 1,
    "skipped": 4,
    "failed": 1,
    "blankRowsIgnored": 1,
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

- `summary.totalRows === created + updated + skipped + failed` **siempre** (excluye
  `blankRowsIgnored`) — invariante cubierta por prueba de integración.
- Cada arreglo de detalle (`created`, `updated`, `skipped`, `errors`) se trunca a **200**
  elementos; si algún arreglo se truncó, `truncated: true`. Los contadores de `summary`
  son siempre exactos, truncamiento aparte.
- `errors[].column` es el **encabezado literal tal como venía en el archivo** (no el
  nombre canónico), para que se ubique a simple vista. El tipo declarado es
  `string | null`, pero en la implementación actual toda fila de `errors[]` está
  siempre asociada a una columna concreta (nombre, categoría, documento o notas), así
  que en la práctica `column` nunca sale `null` hoy — queda como posibilidad abierta
  para un futuro tipo de error que no sea de una columna específica.
- `row` en todos los arreglos es el número de fila **tal como se ve en Excel**
  (1-based, contando el encabezado); la primera fila de datos suele ser la fila `2`.

### Códigos de fila (`errors[].code`) — lista cerrada

| Código | Causa |
|---|---|
| `NOMBRE_VACIO` | Celda de nombre vacía. |
| `NOMBRE_MUY_CORTO` | Nombre normalizado con menos de 3 caracteres. |
| `NOMBRE_MUY_LARGO` | Nombre normalizado con más de 120 caracteres. |
| `NOMBRE_CARACTERES_INVALIDOS` | El nombre trae dígitos u otro carácter fuera de letras/espacios/`'`/`.`/`-`. |
| `CATEGORIA_VACIA` | Columna `category` presente pero celda vacía. |
| `CATEGORIA_INVALIDA` | Valor de categoría fuera de la tabla cerrada de alias. |
| `DOCUMENTO_INVALIDO` | Documento normalizado con menos de 3 caracteres, o con caracteres fuera de `[A-Z0-9]`. |
| `DOCUMENTO_MUY_LARGO` | Documento normalizado con más de 30 caracteres. |
| `NOTAS_MUY_LARGAS` | Notas con más de 500 caracteres. |

### Códigos de omisión (`skipped[].code`) — lista cerrada

| Código | Causa | HTTP |
|---|---|---|
| `DUPLICADO_EN_ARCHIVO_DOCUMENTO` | Mismo documento normalizado ya apareció antes en el archivo; gana la primera fila. | 200 (fila omitida) |
| `DUPLICADO_EN_ARCHIVO_NOMBRE` | Mismo nombre normalizado (sin documento en ninguna de las dos filas) ya apareció antes en el archivo. | 200 |
| `NOMBRE_DUPLICADO_EN_BD` | La fila no trae documento (o trae uno que no existe en la base) y el nombre normalizado coincide con alguien que ya está en la base. No se actualiza nada. | 200 |
| `PERSONA_INACTIVA` | El documento coincide con alguien que existe pero está dado de baja (`active: false`). No se reactiva ni se actualiza automáticamente. | 200 |
| `SIN_CAMBIOS` | El documento coincide con alguien activo y ningún campo entrante difiere del valor actual. | 200 |

### Códigos de archivo inutilizable (400) y otros

| Código | HTTP | Causa |
|---|---|---|
| `FORMATO_NO_SOPORTADO` | 400 | Extensión distinta de `.csv`/`.xlsx` (incluye el caso explícito `.xls`). |
| `ARCHIVO_VACIO` | 400 | No se envió ningún archivo en el campo `file`, o el archivo/hoja no tiene ni una fila con contenido. |
| `SIN_FILAS_DE_DATOS` | 400 | Hay encabezado pero ninguna fila de datos (todas vacías o no hay ninguna). |
| `COLUMNA_REQUERIDA_FALTANTE` | 400 | Falta `fullName` y/o `category` en el encabezado. |
| `ENCABEZADO_AMBIGUO` | 400 | Dos columnas del archivo mapean a la misma columna canónica. |
| `DEMASIADAS_FILAS` | 400 | Más de 2000 filas de datos. |
| `ARCHIVO_MUY_GRANDE` | 413 | Archivo mayor a 2 MB (lo detecta `multer`, antes de leer el contenido). |
| `ARCHIVO_INVALIDO` | 400 | Campo de archivo con nombre distinto de `file`, más de un archivo adjunto, u otro error de multipart no reconocido. No forma parte de la lista cerrada original del contrato de diseño (ver nota en la tabla de "Archivos por request" más arriba). |

---

## Reglas de deduplicación, en criollo

Pensado para quien va a re-importar el mismo padrón corregido mes a mes, sin jerga
técnica:

1. **Si la persona tiene documento**, ese documento es su identidad. Da igual cómo se
   escriba — con puntos, espacios o guiones (`1.234.567`, `1 234 567`, `1234567`): el
   sistema lo trata siempre como el mismo documento.
2. **Si la persona no tiene documento** (columna vacía o ausente), el sistema la
   reconoce por su **nombre completo**, ignorando mayúsculas, tildes y espacios de más.
   Es una comparación menos segura que el documento — por eso es solo el "plan B".
3. **Dentro del mismo archivo**, si dos filas describen a la misma persona (mismo
   documento, o mismo nombre sin documento), **gana la primera**. La segunda no se
   pierde: aparece en el reporte como omitida, indicando en qué fila está la que sí se
   usó.
4. **Al reimportar contra personas que ya están en el sistema:**
   - Si el documento coincide con alguien **activo**, se **actualiza** su nombre,
     categoría y/o notas con lo que trae el archivo (una celda de notas vacía nunca
     borra notas que ya existían).
   - Si el documento coincide con alguien **dado de baja**, el sistema **no lo
     reactiva ni lo actualiza solo**: lo reporta para que el administrador decida
     (reactivar es una acción manual, vía `PATCH .../:id` con `active: true`).
   - Si no hay documento y el **nombre** coincide con alguien que ya existe, el
     sistema **no actualiza nada** — dos personas distintas pueden llamarse igual, y
     actualizar a ciegas por nombre podría, por ejemplo, convertir sin querer a un
     "instructor" real en "ministro". El archivo reporta el caso y no toca
     nada; el administrador revisa y decide a mano.
   - Si no coincide con nadie, se **crea** una persona nueva.

En corto: **reimportar el padrón completo cada mes es seguro** en el sentido de que
nunca borra ni reactiva a nadie por sorpresa — en el peor caso, una fila queda
"omitida" en el reporte para que el administrador la revise.

---

## Tabla resumen de códigos de estado

| Endpoint | Éxito | Errores posibles |
|---|---|---|
| `GET /api/people` | 200 | 400 (query inválida), 401 |
| `POST /api/people` | 201 | 400, 409 `DOCUMENTO_DUPLICADO` / `NOMBRE_DUPLICADO`, 401 |
| `PATCH /api/people/:id` | 200 | 400 (incl. body vacío `SIN_CAMBIOS`), 404, 409 `DOCUMENTO_DUPLICADO`, 401 |
| `DELETE /api/people/:id` | 200 | 404, 401 |
| `DELETE /api/people/:id?purge=true` | 200 | 404, 409 `PERSONA_CON_HISTORIAL`, 401 |
| `POST /api/people/import` | 200 (si el archivo se pudo parsear) | 400 (archivo inutilizable, ver tabla de códigos), 413 `ARCHIVO_MUY_GRANDE`, 401 |

No existe `GET /api/people/:id`: la fila del listado ya trae todos los campos
editables, así que no hace falta un detalle aparte.
