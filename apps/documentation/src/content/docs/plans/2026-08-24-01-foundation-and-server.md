---
title: "laqi v2 — Plan 1: Fundación y servidor de mocks"
---

# laqi v2 — Plan 1: Fundación y servidor de mocks

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un `laqi` que corre, carga mocks desde `laqi.json` o `laqi/`, los valida, los sirve con las cuatro capas de resolución, recarga en caliente sin reiniciar el proceso, y migra proyectos de v1.

**Architecture:** Monorepo Bun + Turborepo. `packages/schema` define los esquemas Zod y es la única fuente de verdad del formato. `packages/core` carga archivos (tolerante a fallos por archivo), construye la tabla de rutas detectando colisiones, y resuelve qué respuesta está viva. `packages/server` es una app Hono construida a partir de esa tabla, sobre Web Standards para que el mismo código corra después en Cloudflare Workers. `apps/cli` orquesta: config, watcher e intercambio en caliente de la tabla de rutas.

**Tech Stack:** Bun 1.3 (workspaces + catalog), Turborepo, TypeScript 5.9, Hono 4.12, Zod 4.3, Vitest 2, oxlint + oxfmt, tsdown.

**Spec:** [`docs/decisiones/`](../decisions/) (ADRs 0001–0008), [`docs/conceptos/`](../concepts/), [`docs/diseno/STATE-MODEL.md`](/design/state-model/)

## Global Constraints

- **TDD obligatorio.** Ningún código de producción sin un test que falle primero. Única excepción en este plan: la Tarea 1, que es configuración pura.
- **TypeScript estricto**, ESM (`"type": "module"`). Nada de CommonJS.
- **Zod 4.3.6, Hono 4.12.3** — versiones exactas, vía el catalog de Bun.
- **`packages/server` no puede importar nada de Node** (`fs`, `path`, `process`). Sólo Web Standards. El acceso a disco vive en `core` y `cli`. Esto es lo que permite que el mismo servidor corra en Cloudflare Workers en el Plan 4.
- **`/__laqi` es prefijo reservado.** Ningún mock puede declarar una ruta que empiece así.
- **Los errores de carga son ruidosos pero no fatales.** Un archivo inválido reporta su error y retira sólo sus endpoints; el resto se sigue sirviendo.
- **Ninguna request cuelga jamás.** Todo camino de resolución termina en una respuesta HTTP, incluidos los errores (defecto C de v1).
- **Nunca se muta el objeto de respuesta cargado.** Todo cuerpo servido es una copia (defecto A de v1).
- **El header de trazabilidad es exactamente `X-Laqi-Resolved: <name> (<layer>)`**, con `<layer>` ∈ `header | state | scenario | default`. Sin excepciones — el panel imprime ese string verbatim.
- Commits con Conventional Commits (`feat:`, `fix:`, `test:`, `chore:`).

## Notas para el ejecutor

Este plan se ejecuta tarea por tarea con subagentes en un modelo económico. Reglas:

- **Copia el código de los bloques tal cual.** No "mejores" nombres, tipos ni
  estructura. Si un bloque no compila, el error es del plan: repórtalo en vez de
  improvisar una alternativa.
- **No cambies versiones de dependencias** ni añadas dependencias nuevas.
- **No debilites un test para que pase.** Si un test falla por una razón distinta
  a la esperada en el paso "verificar que falla", detente y repórtalo.
- Corre los tests filtrados que indica cada paso; antes de cada commit corre
  además `bun run test` completo y `bun run check-types`.
- Los mensajes de commit son exactamente los del plan.
- Las APIs de terceros que usa este plan (Zod 4.3.6, Hono 4.12.3, chokidar 4,
  @hono/node-server 1.19) **fueron verificadas ejecutándolas** antes de escribir
  el plan, incluidos el patrón de hot-swap, el watch de la raíz con poda y los
  formatos de error de `JSON.parse`. No consultes documentación externa para
  "corregirlas".

## Nota de reconciliación

`docs/conceptos/resolucion-de-estado.md` dice que un `X-Laqi-Scenario` reporta origen `scenario:<nombre>`. El diseño (`STATE-MODEL.md`) define **cuatro palabras de capa y sólo cuatro**, porque el panel mapea cada una a un color.

**Manda el diseño:** `X-Laqi-Scenario` resuelve usando el mapa del escenario pero reporta capa **`header`**, porque no persiste nada. La Tarea 8 corrige el documento del concepto.

---

## Estructura de archivos

```
laqi/
├── package.json                     workspaces + catalog + scripts raíz
├── turbo.json                       pipeline de tareas
├── vitest.config.ts                 un solo runner para todo el monorepo
├── tsconfig.json                    referencias
├── .oxlintrc.json / .oxfmtrc.json
├── .gitignore                       incluye .laqi/
├── packages/
│   ├── config/
│   │   └── tsconfig.base.json       compilerOptions compartidos
│   ├── schema/                      SIN dependencias salvo zod
│   │   ├── package.json
│   │   └── src/
│   │       ├── index.ts             re-exports
│   │       ├── method.ts            HTTP_METHODS, HttpMethod
│   │       ├── response.ts          ResponseSchema
│   │       ├── endpoint.ts          EndpointSchema
│   │       ├── endpoint-key.ts      parseEndpointKey, formatEndpointId, RESERVED_PREFIX
│   │       ├── scenarios.ts         ScenariosSchema
│   │       ├── state.ts             StateSchema
│   │       └── config.ts            ConfigSchema
│   ├── core/                        depende de schema + node:fs
│   │   ├── package.json
│   │   └── src/
│   │       ├── index.ts
│   │       ├── json-position.ts     posición → línea/columna + extracto
│   │       ├── loader.ts            lee y valida archivos, tolerante por archivo
│   │       ├── route-table.ts       construye la tabla, detecta colisiones
│   │       ├── state-store.ts       lee/escribe .laqi/state.json
│   │       └── resolve.ts           las cuatro capas
│   └── server/                      depende de schema + core (sólo tipos) + hono
│       ├── package.json
│       └── src/
│           ├── index.ts
│           └── mock-app.ts          createMockApp(getRuntime)
└── apps/
    └── cli/                         depende de todo
        ├── package.json
        └── src/
            ├── index.ts             entry point, dispatch de comandos
            ├── serve.ts             comando por defecto: carga, sirve, observa
            ├── watcher.ts           watcher con debounce
            └── migrate.ts           comando `laqi migrate`
```

**Por qué esta división:** `schema` no depende de nada, así que lo pueden importar el editor (navegador), el MCP y el CLI sin arrastrar Node. `server` no toca disco, que es lo que lo hace desplegable al edge. `core` es el único que sabe de archivos.

---

## Task 1: Andamiaje del monorepo

**Files:**

- Create: `package.json`, `turbo.json`, `vitest.config.ts`, `tsconfig.json`, `.oxlintrc.json`, `.oxfmtrc.json`, `.gitignore`, `packages/config/tsconfig.base.json`, `packages/config/package.json`

**Interfaces:**

- Consumes: nada
- Produces: los scripts `bun run test`, `bun run check-types`, `bun run lint`; el catalog con `hono`, `zod`, `typescript`, `tsdown`

**Excepción de TDD:** esta tarea es configuración pura, permitida por la política. Igual termina con una verificación ejecutable.

- [ ] **Step 1: Borrar v1**

```bash
git rm -r --cached src cli.js mock-data mock.config.json .env.example package-lock.json
rm -rf src cli.js mock-data mock.config.json .env.example package-lock.json node_modules
```

`README.md`, `LICENSE.md`, `documentacion/` y `docs/` se quedan.

- [ ] **Step 2: `package.json` raíz**

```json
{
  "name": "laqi-monorepo",
  "version": "2.0.0",
  "private": true,
  "type": "module",
  "workspaces": {
    "packages": ["apps/*", "packages/*"],
    "catalog": {
      "hono": "4.12.3",
      "zod": "4.3.6",
      "typescript": "5.9.3",
      "tsdown": "0.18.4",
      "@types/bun": "^1.3.4"
    }
  },
  "scripts": {
    "lint": "oxlint",
    "format": "oxfmt --write .",
    "check": "bun run lint && bun run format",
    "build": "turbo run build",
    "check-types": "turbo run check-types",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "oxfmt": "^0.19.0",
    "oxlint": "^1.34.0",
    "turbo": "^2.6.3",
    "typescript": "catalog:",
    "vitest": "^2.1.0"
  },
  "packageManager": "bun@1.3.4"
}
```

- [ ] **Step 3: `turbo.json`**

```json
{
  "$schema": "https://turbo.build/schema.json",
  "ui": "tui",
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**"] },
    "check-types": { "dependsOn": ["^build"] },
    "dev": { "cache": false, "persistent": true }
  }
}
```

- [ ] **Step 4: `vitest.config.ts` y `tsconfig.json` raíz**

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['{packages,apps}/*/src/**/*.test.ts'],
    environment: 'node',
  },
})
```

```json
// tsconfig.json
{
  "extends": "./packages/config/tsconfig.base.json",
  "include": ["packages/*/src/**/*", "apps/*/src/**/*", "*.ts"]
}
```

- [ ] **Step 5: `packages/config/`**

```json
// packages/config/package.json
{
  "name": "@laqi/config",
  "version": "2.0.0",
  "private": true,
  "type": "module",
  "files": ["tsconfig.base.json"]
}
```

```json
// packages/config/tsconfig.base.json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "verbatimModuleSyntax": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true,
    "resolveJsonModule": true
  }
}
```

- [ ] **Step 6: `.gitignore`, `.oxlintrc.json`, `.oxfmtrc.json`**

```
# .gitignore
node_modules
dist
.turbo
.laqi/
*.tsbuildinfo
```

```json
// .oxlintrc.json
{ "$schema": "./node_modules/oxlint/configuration_schema.json", "categories": { "correctness": "error", "suspicious": "warn" } }
```

```json
// .oxfmtrc.json
{ "singleQuote": true, "semi": false, "printWidth": 100 }
```

- [ ] **Step 7: Verificar**

```bash
bun install
bun run check-types
bun run lint
```

Esperado: los tres terminan sin error. `bun run test` dice "No test files found", que es correcto — todavía no hay ninguno.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: scaffold v2 monorepo, remove v1 source"
```

---

## Task 2: `packages/schema` — esquema de respuesta

**Files:**

- Create: `packages/schema/package.json`, `packages/schema/src/method.ts`, `packages/schema/src/response.ts`, `packages/schema/src/response.test.ts`, `packages/schema/src/index.ts`

**Interfaces:**

- Consumes: nada
- Produces: `HTTP_METHODS: readonly HttpMethod[]`, `type HttpMethod`, `ResponseSchema: z.ZodType`, `type MockResponse = { status: number; body?: unknown; delay?: number; headers?: Record<string,string>; description?: string }`

- [ ] **Step 1: `package.json` del paquete**

```json
{
  "name": "@laqi/schema",
  "version": "2.0.0",
  "type": "module",
  "exports": { ".": "./src/index.ts", "./package.json": "./package.json" },
  "dependencies": { "zod": "catalog:" },
  "scripts": { "check-types": "tsc --noEmit -p ." }
}
```

Y `packages/schema/tsconfig.json`:

```json
{ "extends": "../config/tsconfig.base.json", "include": ["src/**/*"] }
```

- [ ] **Step 2: Escribir el test que falla**

```ts
// packages/schema/src/response.test.ts
import { describe, expect, it } from 'vitest'
import { ResponseSchema } from './response'

describe('ResponseSchema', () => {
  it('accepts a minimal response', () => {
    const parsed = ResponseSchema.parse({ status: 200, body: { message: 'OK' } })
    expect(parsed.status).toBe(200)
  })

  it('accepts a response with no body (204)', () => {
    expect(ResponseSchema.parse({ status: 204 }).status).toBe(204)
  })

  it('accepts delay and headers', () => {
    const parsed = ResponseSchema.parse({
      status: 200,
      body: [],
      delay: 3000,
      headers: { 'x-custom': 'yes' },
    })
    expect(parsed.delay).toBe(3000)
    expect(parsed.headers).toEqual({ 'x-custom': 'yes' })
  })

  it('rejects a status outside 100-599', () => {
    expect(ResponseSchema.safeParse({ status: 99 }).success).toBe(false)
    expect(ResponseSchema.safeParse({ status: 600 }).success).toBe(false)
  })

  it('rejects a status given as a string (v1 defect I)', () => {
    expect(ResponseSchema.safeParse({ status: '200' }).success).toBe(false)
  })

  it('rejects a negative delay', () => {
    expect(ResponseSchema.safeParse({ status: 200, delay: -1 }).success).toBe(false)
  })
})
```

- [ ] **Step 3: Correr el test y verificar que falla**

Run: `bun run test -- response`
Expected: FAIL — `Failed to resolve import "./response"`

- [ ] **Step 4: Implementar**

```ts
// packages/schema/src/method.ts
export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const

export type HttpMethod = (typeof HTTP_METHODS)[number]

export function isHttpMethod(value: string): value is HttpMethod {
  return (HTTP_METHODS as readonly string[]).includes(value)
}
```

```ts
// packages/schema/src/response.ts
import { z } from 'zod'

/** Un mock nunca debería tardar más de un minuto; más allá es un typo. */
export const MAX_DELAY_MS = 60_000

export const ResponseSchema = z.object({
  status: z.number().int().min(100).max(599),
  body: z.unknown().optional(),
  delay: z.number().int().min(0).max(MAX_DELAY_MS).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  description: z.string().optional(),
})

export type MockResponse = z.infer<typeof ResponseSchema>
```

```ts
// packages/schema/src/index.ts
export * from './method'
export * from './response'
```

- [ ] **Step 5: Correr el test y verificar que pasa**

Run: `bun run test -- response`
Expected: PASS, 6 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/schema
git commit -m "feat(schema): add response schema with numeric status codes"
```

---

## Task 3: `packages/schema` — parseo de la clave de endpoint

Es lo que entierra el hack `(get)files/:id` de v1 y lo que hace cumplir el prefijo reservado (hallazgo H7).

**Files:**

- Create: `packages/schema/src/endpoint-key.ts`, `packages/schema/src/endpoint-key.test.ts`
- Modify: `packages/schema/src/index.ts`

**Interfaces:**

- Consumes: `HttpMethod`, `HTTP_METHODS`, `isHttpMethod` (Tarea 2)
- Produces: `RESERVED_PREFIX = '/__laqi'`, `parseEndpointKey(key: string): ParseKeyResult`, `formatEndpointId(method, path): string`, `type ParsedKey = { method: HttpMethod; path: string }`, `type ParseKeyResult = { ok: true; value: ParsedKey } | { ok: false; error: string }`

- [ ] **Step 1: Escribir el test que falla**

```ts
// packages/schema/src/endpoint-key.test.ts
import { describe, expect, it } from 'vitest'
import { formatEndpointId, parseEndpointKey, RESERVED_PREFIX } from './endpoint-key'

function ok(key: string) {
  const result = parseEndpointKey(key)
  if (!result.ok) throw new Error(`expected ok, got error: ${result.error}`)
  return result.value
}

function err(key: string) {
  const result = parseEndpointKey(key)
  if (result.ok) throw new Error(`expected error, got ok`)
  return result.error
}

describe('parseEndpointKey', () => {
  it('parses "GET /users"', () => {
    expect(ok('GET /users')).toEqual({ method: 'GET', path: '/users' })
  })

  it('parses a path with params', () => {
    expect(ok('DELETE /users/:id/orders/:orderId')).toEqual({
      method: 'DELETE',
      path: '/users/:id/orders/:orderId',
    })
  })

  it('normalises the method to uppercase', () => {
    expect(ok('post /users').method).toBe('POST')
  })

  it('tolerates extra whitespace', () => {
    expect(ok('  GET   /users  ')).toEqual({ method: 'GET', path: '/users' })
  })

  it('allows the same path under different methods', () => {
    expect(ok('GET /users').path).toBe(ok('POST /users').path)
  })

  it('rejects a key with no method', () => {
    expect(err('/users')).toContain('METHOD /path')
  })

  it('rejects an unknown method', () => {
    expect(err('FETCH /users')).toContain('FETCH')
  })

  it('rejects a path that does not start with a slash', () => {
    expect(err('GET users')).toContain('must start with')
  })

  it('rejects the v1 method-prefix hack', () => {
    expect(err('(get)files/:id')).toContain('METHOD /path')
  })

  it('rejects the reserved control-panel prefix', () => {
    expect(err('GET /__laqi')).toContain(RESERVED_PREFIX)
    expect(err('GET /__laqi/api/state')).toContain(RESERVED_PREFIX)
  })

  it('does not reject a path that merely starts with the same letters', () => {
    expect(ok('GET /__laqidose').path).toBe('/__laqidose')
  })
})

describe('formatEndpointId', () => {
  it('round-trips with parseEndpointKey', () => {
    const id = formatEndpointId('GET', '/users/:id')
    expect(id).toBe('GET /users/:id')
    expect(ok(id)).toEqual({ method: 'GET', path: '/users/:id' })
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `bun run test -- endpoint-key`
Expected: FAIL — `Failed to resolve import "./endpoint-key"`

- [ ] **Step 3: Implementar**

```ts
// packages/schema/src/endpoint-key.ts
import { HTTP_METHODS, isHttpMethod, type HttpMethod } from './method'

/** Prefijo del control panel. Ningún mock puede declarar rutas acá debajo. */
export const RESERVED_PREFIX = '/__laqi'

export type ParsedKey = { method: HttpMethod; path: string }

export type ParseKeyResult =
  | { ok: true; value: ParsedKey }
  | { ok: false; error: string }

const KEY_PATTERN = /^([A-Za-z]+)\s+(\S+)$/

export function parseEndpointKey(key: string): ParseKeyResult {
  const match = KEY_PATTERN.exec(key.trim())
  if (!match) {
    return {
      ok: false,
      error: `endpoint key must be "METHOD /path" (for example "GET /users"), got ${JSON.stringify(key)}`,
    }
  }

  const [, rawMethod = '', path = ''] = match
  const method = rawMethod.toUpperCase()

  if (!isHttpMethod(method)) {
    return {
      ok: false,
      error: `unknown HTTP method ${JSON.stringify(rawMethod)} in ${JSON.stringify(key)}. Allowed: ${HTTP_METHODS.join(', ')}`,
    }
  }

  if (!path.startsWith('/')) {
    return { ok: false, error: `path must start with "/" in ${JSON.stringify(key)}` }
  }

  if (path === RESERVED_PREFIX || path.startsWith(`${RESERVED_PREFIX}/`)) {
    return {
      ok: false,
      error: `${RESERVED_PREFIX} is reserved by the laqi control panel and cannot be mocked (${JSON.stringify(key)})`,
    }
  }

  return { ok: true, value: { method, path } }
}

export function formatEndpointId(method: HttpMethod, path: string): string {
  return `${method} ${path}`
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `bun run test -- endpoint-key`
Expected: PASS, 12 tests.

- [ ] **Step 5: Exportar desde el índice**

```ts
// packages/schema/src/index.ts
export * from './method'
export * from './response'
export * from './endpoint-key'
```

- [ ] **Step 6: Commit**

```bash
git add packages/schema
git commit -m "feat(schema): parse \"METHOD /path\" endpoint keys, reject reserved prefix"
```

---

## Task 4: `packages/schema` — endpoint, escenarios, estado y config

**Files:**

- Create: `packages/schema/src/endpoint.ts`, `packages/schema/src/endpoint.test.ts`, `packages/schema/src/scenarios.ts`, `packages/schema/src/state.ts`, `packages/schema/src/config.ts`, `packages/schema/src/state.test.ts`
- Modify: `packages/schema/src/index.ts`

**Interfaces:**

- Consumes: `ResponseSchema`, `MockResponse` (Tarea 2)
- Produces: `EndpointSchema`, `type EndpointDefinition = { description?: string; default: string; responses: Record<string, MockResponse> }`, `MockFileSchema`, `ScenariosSchema`, `type Scenarios = Record<string, Record<string,string>>`, `StateSchema`, `type LaqiState = { scenario: string | null; overrides: Record<string,string> }`, `ConfigSchema`, `type LaqiConfig`, `DEFAULT_STATE: LaqiState`

- [ ] **Step 1: Escribir el test que falla**

```ts
// packages/schema/src/endpoint.test.ts
import { describe, expect, it } from 'vitest'
import { EndpointSchema } from './endpoint'

const valid = {
  description: 'List all users',
  default: 'ok',
  responses: {
    ok: { status: 200, body: [] },
    boom: { status: 500, body: { code: 'INTERNAL' } },
  },
}

describe('EndpointSchema', () => {
  it('accepts a valid endpoint', () => {
    expect(EndpointSchema.parse(valid).default).toBe('ok')
  })

  it('rejects a default that names no declared response (v1 defect C)', () => {
    const result = EndpointSchema.safeParse({ ...valid, default: 'nope' })
    expect(result.success).toBe(false)
    if (result.success) return
    const issue = result.error.issues[0]
    expect(issue?.message).toContain('nope')
    expect(issue?.message).toContain('ok')
    expect(issue?.path).toEqual(['default'])
  })

  it('rejects an endpoint with no responses', () => {
    expect(EndpointSchema.safeParse({ default: 'ok', responses: {} }).success).toBe(false)
  })

  it('rejects a null entry (v1 defect B)', () => {
    expect(EndpointSchema.safeParse(null).success).toBe(false)
  })

  it('rejects a v1-shaped endpoint', () => {
    const v1 = {
      method: 'GET',
      codeResponse: '200',
      responses: [{ statusCode: '200', selectorCode: '200', body: {} }],
    }
    expect(EndpointSchema.safeParse(v1).success).toBe(false)
  })
})
```

```ts
// packages/schema/src/state.test.ts
import { describe, expect, it } from 'vitest'
import { ConfigSchema } from './config'
import { ScenariosSchema } from './scenarios'
import { DEFAULT_STATE, StateSchema } from './state'

describe('StateSchema', () => {
  it('fills in an empty state', () => {
    expect(StateSchema.parse({})).toEqual({ scenario: null, overrides: {} })
  })

  it('keeps overrides and the active scenario', () => {
    const parsed = StateSchema.parse({
      scenario: 'checkout-broken',
      overrides: { 'GET /users': 'boom' },
    })
    expect(parsed.scenario).toBe('checkout-broken')
    expect(parsed.overrides['GET /users']).toBe('boom')
  })

  it('exposes an empty DEFAULT_STATE', () => {
    expect(DEFAULT_STATE).toEqual({ scenario: null, overrides: {} })
  })
})

describe('ScenariosSchema', () => {
  it('maps a scenario name to endpoint/response pairs', () => {
    const parsed = ScenariosSchema.parse({
      'checkout-broken': { 'POST /orders': 'boom', 'GET /cart': 'empty' },
    })
    expect(parsed['checkout-broken']?.['POST /orders']).toBe('boom')
  })
})

describe('ConfigSchema', () => {
  it('applies defaults when the file is absent', () => {
    const parsed = ConfigSchema.parse({})
    expect(parsed.port).toBe(8000)
    expect(parsed.host).toBe('127.0.0.1')
    expect(parsed.dir).toBe('laqi')
    expect(parsed.file).toBe('laqi.json')
  })

  it('rejects an out-of-range port', () => {
    expect(ConfigSchema.safeParse({ port: -1 }).success).toBe(false)
    expect(ConfigSchema.safeParse({ port: 70000 }).success).toBe(false)
  })
})
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `bun run test -- endpoint state`
Expected: FAIL — imports sin resolver.

- [ ] **Step 3: Implementar**

```ts
// packages/schema/src/endpoint.ts
import { z } from 'zod'
import { ResponseSchema } from './response'

export const EndpointSchema = z
  .object({
    description: z.string().optional(),
    default: z.string().min(1),
    responses: z.record(z.string(), ResponseSchema),
  })
  .superRefine((endpoint, ctx) => {
    const names = Object.keys(endpoint.responses)

    if (names.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['responses'],
        message: 'an endpoint needs at least one response',
      })
      return
    }

    if (!names.includes(endpoint.default)) {
      ctx.addIssue({
        code: 'custom',
        path: ['default'],
        message: `default ${JSON.stringify(endpoint.default)} is not a declared response. Available: ${names.join(', ')}`,
      })
    }
  })

export type EndpointDefinition = z.infer<typeof EndpointSchema>
```

```ts
// packages/schema/src/scenarios.ts
import { z } from 'zod'

export const ScenariosSchema = z.record(z.string(), z.record(z.string(), z.string()))

export type Scenarios = z.infer<typeof ScenariosSchema>
```

```ts
// packages/schema/src/state.ts
import { z } from 'zod'

export const StateSchema = z.object({
  scenario: z.string().nullable().default(null),
  overrides: z.record(z.string(), z.string()).default({}),
})

export type LaqiState = z.infer<typeof StateSchema>

export const DEFAULT_STATE: LaqiState = { scenario: null, overrides: {} }
```

```ts
// packages/schema/src/config.ts
import { z } from 'zod'

export const ConfigSchema = z.object({
  /** 0 = puerto efímero asignado por el SO; lo usan los tests. */
  port: z.number().int().min(0).max(65535).default(8000),
  host: z.string().default('127.0.0.1'),
  /** Carpeta de mocks (modo carpeta). */
  dir: z.string().default('laqi'),
  /** Archivo único (modo archivo). Se usa si `dir` no existe. */
  file: z.string().default('laqi.json'),
  /** '*' o una lista blanca de orígenes. Nunca '*' con --share (ADR-0007). */
  cors: z.union([z.literal('*'), z.array(z.string())]).default('*'),
  /** Preferencias del panel (hallazgo H12). */
  density: z.enum(['regular', 'compact']).default('regular'),
  showDescriptions: z.boolean().default(true),
})

export type LaqiConfig = z.infer<typeof ConfigSchema>
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `bun run test -- endpoint state`
Expected: PASS, 10 tests.

- [ ] **Step 5: Exportar todo**

```ts
// packages/schema/src/index.ts
export * from './method'
export * from './response'
export * from './endpoint-key'
export * from './endpoint'
export * from './scenarios'
export * from './state'
export * from './config'
```

- [ ] **Step 6: Commit**

```bash
git add packages/schema
git commit -m "feat(schema): add endpoint, scenarios, state and config schemas"
```

---

## Task 5: `packages/core` — posición en JSON y extracto de fuente

Alimenta la banda de error del panel (flujo F8): archivo, línea, columna y tres líneas de contexto con un caret.

**Files:**

- Create: `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/src/json-position.ts`, `packages/core/src/json-position.test.ts`

**Interfaces:**

- Consumes: nada
- Produces: `offsetToPosition(source: string, offset: number): { line: number; col: number }`, `buildExcerpt(source: string, line: number, col: number): string`, `parseJsonWithPosition(source: string): JsonParseResult` donde `JsonParseResult = { ok: true; value: unknown } | { ok: false; message: string; line: number; col: number; excerpt: string }`

- [ ] **Step 1: `package.json` y `tsconfig.json` del paquete**

```json
{
  "name": "@laqi/core",
  "version": "2.0.0",
  "type": "module",
  "exports": { ".": "./src/index.ts", "./package.json": "./package.json" },
  "dependencies": { "@laqi/schema": "workspace:*", "zod": "catalog:" },
  "devDependencies": { "@types/bun": "catalog:" },
  "scripts": { "check-types": "tsc --noEmit -p ." }
}
```

```json
{ "extends": "../config/tsconfig.base.json", "include": ["src/**/*"] }
```

- [ ] **Step 2: Escribir el test que falla**

```ts
// packages/core/src/json-position.test.ts
import { describe, expect, it } from 'vitest'
import { buildExcerpt, offsetToPosition, parseJsonWithPosition } from './json-position'

const source = 'line one\nline two\nline three\n'

describe('offsetToPosition', () => {
  it('reports 1:1 at offset zero', () => {
    expect(offsetToPosition(source, 0)).toEqual({ line: 1, col: 1 })
  })

  it('reports the column within the first line', () => {
    expect(offsetToPosition(source, 5)).toEqual({ line: 1, col: 6 })
  })

  it('reports the start of the second line', () => {
    expect(offsetToPosition(source, 9)).toEqual({ line: 2, col: 1 })
  })

  it('clamps an offset past the end', () => {
    const position = offsetToPosition(source, 9999)
    expect(position.line).toBe(4)
  })
})

describe('buildExcerpt', () => {
  it('renders the line with its neighbours and a caret', () => {
    const excerpt = buildExcerpt(source, 2, 6)
    expect(excerpt).toContain('1 | line one')
    expect(excerpt).toContain('2 | line two')
    expect(excerpt).toContain('3 | line three')
    expect(excerpt).toContain('^')
  })

  it('does not run off the top of the file', () => {
    expect(buildExcerpt(source, 1, 1)).toContain('1 | line one')
  })
})

describe('parseJsonWithPosition', () => {
  it('returns the parsed value for valid JSON', () => {
    const result = parseJsonWithPosition('{"a":1}')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toEqual({ a: 1 })
  })

  it('reports line and column for a trailing comma', () => {
    const broken = '{\n  "a": 1,\n  "b": 2,\n}\n'
    const result = parseJsonWithPosition(broken)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.line).toBe(4)
    expect(result.message.length).toBeGreaterThan(0)
    expect(result.excerpt).toContain('^')
  })

  it('never throws, whatever the input', () => {
    expect(() => parseJsonWithPosition('')).not.toThrow()
    expect(() => parseJsonWithPosition('not json at all')).not.toThrow()
    expect(parseJsonWithPosition('').ok).toBe(false)
  })
})
```

- [ ] **Step 3: Correr el test y verificar que falla**

Run: `bun run test -- json-position`
Expected: FAIL — `Failed to resolve import "./json-position"`

- [ ] **Step 4: Implementar**

```ts
// packages/core/src/json-position.ts

export type Position = { line: number; col: number }

export type JsonParseResult =
  | { ok: true; value: unknown }
  | { ok: false; message: string; line: number; col: number; excerpt: string }

/** Convierte un offset de caracteres en línea/columna 1-based. */
export function offsetToPosition(source: string, offset: number): Position {
  const clamped = Math.max(0, Math.min(offset, source.length))
  let line = 1
  let lastBreak = -1

  for (let i = 0; i < clamped; i++) {
    if (source[i] === '\n') {
      line++
      lastBreak = i
    }
  }

  return { line, col: clamped - lastBreak }
}

/**
 * Tres líneas de contexto con un caret bajo la columna que falla.
 * El formato lo consume tal cual la banda de error del panel (F8).
 */
export function buildExcerpt(source: string, line: number, col: number): string {
  const lines = source.split('\n')
  const first = Math.max(1, line - 2)
  const last = Math.min(lines.length, line + 1)
  const gutter = String(last).length

  const rendered: string[] = []
  for (let n = first; n <= last; n++) {
    rendered.push(`${String(n).padStart(gutter)} | ${lines[n - 1] ?? ''}`)
    if (n === line) {
      rendered.push(`${' '.repeat(gutter)} | ${' '.repeat(Math.max(0, col - 1))}^`)
    }
  }

  return rendered.join('\n')
}

/**
 * V8 (Node) incluye la posición en el mensaje — formato viejo `at position N` y
 * formato nuevo `(line N column N)`. JavaScriptCore (Bun) no incluye ninguna.
 * El CLI publicado corre en Node, así que producción siempre tiene posición;
 * bajo Bun (desarrollo) se degrada a línea 1 con el mensaje completo.
 */
const OFFSET_PATTERN = /at position (\d+)/
const LINE_COL_PATTERN = /\(line (\d+) column (\d+)\)/

export function parseJsonWithPosition(source: string): JsonParseResult {
  try {
    return { ok: true, value: JSON.parse(source) as unknown }
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error)

    const lineCol = LINE_COL_PATTERN.exec(raw)
    const { line, col } = lineCol
      ? { line: Number(lineCol[1]), col: Number(lineCol[2]) }
      : offsetToPosition(source, Number(OFFSET_PATTERN.exec(raw)?.[1] ?? 0))

    return {
      ok: false,
      // Quitamos la coletilla de posición: la línea y columna van en sus campos.
      message: raw.replace(/\s*in JSON at position \d+.*$/, '').trim() || raw,
      line,
      col,
      excerpt: buildExcerpt(source, line, col),
    }
  }
}
```

- [ ] **Step 5: Correr el test y verificar que pasa**

Run: `bun run test -- json-position`
Expected: PASS, 9 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/core
git commit -m "feat(core): locate JSON parse errors with line, column and excerpt"
```

---

## Task 6: `packages/core` — cargador tolerante a fallos por archivo

Implementa el hallazgo H3: ruidoso pero no fatal. Un archivo roto reporta su error y retira sólo sus endpoints.

**Files:**

- Create: `packages/core/src/loader.ts`, `packages/core/src/loader.test.ts`

**Interfaces:**

- Consumes: `parseJsonWithPosition`, `buildExcerpt` (Tarea 5); `EndpointSchema`, `parseEndpointKey`, `formatEndpointId`, `ScenariosSchema` (Tareas 3–4)
- Produces:
  - `type LoadError = { file: string; line?: number; col?: number; message: string; excerpt?: string }`
  - `type LoadedEndpoint = { id: string; method: HttpMethod; path: string; description?: string; default: string; responses: Record<string, MockResponse>; file: string; line: number }`
  - `type LoadResult = { endpoints: LoadedEndpoint[]; scenarios: Scenarios; errors: LoadError[]; source: 'dir' | 'file' | 'none' }`
  - `loadMocks(options: { root: string; dir: string; file: string }): LoadResult`

- [ ] **Step 1: Escribir el test que falla**

```ts
// packages/core/src/loader.test.ts
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadMocks } from './loader'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'laqi-loader-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function writeMock(relative: string, contents: string) {
  const full = join(root, relative)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, contents, 'utf8')
}

const usersEndpoint = JSON.stringify({
  'GET /users': { default: 'ok', responses: { ok: { status: 200, body: [] } } },
})

const load = () => loadMocks({ root, dir: 'laqi', file: 'laqi.json' })

describe('loadMocks', () => {
  it('returns nothing and no error for a fresh project', () => {
    const result = load()
    expect(result.endpoints).toEqual([])
    expect(result.errors).toEqual([])
    expect(result.source).toBe('none')
  })

  it('loads the single-file mode', () => {
    writeMock('laqi.json', usersEndpoint)
    const result = load()
    expect(result.source).toBe('file')
    expect(result.endpoints).toHaveLength(1)
    expect(result.endpoints[0]?.id).toBe('GET /users')
    expect(result.endpoints[0]?.method).toBe('GET')
    expect(result.endpoints[0]?.path).toBe('/users')
  })

  it('prefers the folder when both exist', () => {
    writeMock('laqi.json', usersEndpoint)
    writeMock('laqi/api.json', usersEndpoint)
    expect(load().source).toBe('dir')
  })

  it('loads several files from the folder', () => {
    writeMock('laqi/api.json', usersEndpoint)
    writeMock(
      'laqi/orders.json',
      JSON.stringify({
        'GET /orders': { default: 'ok', responses: { ok: { status: 200, body: [] } } },
      }),
    )
    const ids = load().endpoints.map((e) => e.id).sort()
    expect(ids).toEqual(['GET /orders', 'GET /users'])
  })

  it('recurses into subfolders', () => {
    writeMock('laqi/v1/api.json', usersEndpoint)
    expect(load().endpoints).toHaveLength(1)
  })

  it('ignores dotfiles', () => {
    writeMock('laqi/.state.json', '{ this is not json }')
    const result = load()
    expect(result.errors).toEqual([])
    expect(result.endpoints).toEqual([])
  })

  it('reads scenarios.json as scenarios, not as endpoints', () => {
    writeMock('laqi/api.json', usersEndpoint)
    writeMock(
      'laqi/scenarios.json',
      JSON.stringify({ 'checkout-broken': { 'GET /users': 'boom' } }),
    )
    const result = load()
    expect(result.endpoints).toHaveLength(1)
    expect(result.scenarios['checkout-broken']).toEqual({ 'GET /users': 'boom' })
  })

  it('keeps serving other files when one has broken JSON (H3)', () => {
    writeMock('laqi/api.json', usersEndpoint)
    writeMock('laqi/orders.json', '{\n  "GET /orders": {},\n}\n')

    const result = load()
    expect(result.endpoints.map((e) => e.id)).toEqual(['GET /users'])
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]?.file).toContain('orders.json')
    expect(result.errors[0]?.line).toBe(3)
    expect(result.errors[0]?.excerpt).toContain('^')
  })

  it('drops only the offending endpoint on a semantic error (H5)', () => {
    writeMock(
      'laqi/api.json',
      JSON.stringify({
        'GET /users': { default: 'ok', responses: { ok: { status: 200, body: [] } } },
        'GET /broken': { default: 'nope', responses: { ok: { status: 200 } } },
      }),
    )

    const result = load()
    expect(result.endpoints.map((e) => e.id)).toEqual(['GET /users'])
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]?.message).toContain('nope')
  })

  it('reports an unparseable endpoint key', () => {
    writeMock('laqi/api.json', JSON.stringify({ '(get)files/:id': { default: 'ok', responses: { ok: { status: 200 } } } }))
    const result = load()
    expect(result.endpoints).toEqual([])
    expect(result.errors[0]?.message).toContain('METHOD /path')
  })

  it('records the line of each endpoint key', () => {
    writeMock('laqi/api.json', '{\n  "GET /users": {\n    "default": "ok",\n    "responses": { "ok": { "status": 200 } }\n  }\n}\n')
    expect(load().endpoints[0]?.line).toBe(2)
  })

  it('preserves file order', () => {
    writeMock(
      'laqi/api.json',
      JSON.stringify({
        'POST /users': { default: 'ok', responses: { ok: { status: 201 } } },
        'GET /users': { default: 'ok', responses: { ok: { status: 200 } } },
      }),
    )
    expect(load().endpoints.map((e) => e.id)).toEqual(['POST /users', 'GET /users'])
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `bun run test -- loader`
Expected: FAIL — `Failed to resolve import "./loader"`

- [ ] **Step 3: Implementar**

```ts
// packages/core/src/loader.ts
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import {
  EndpointSchema,
  formatEndpointId,
  parseEndpointKey,
  ScenariosSchema,
  type HttpMethod,
  type MockResponse,
  type Scenarios,
} from '@laqi/schema'
import { parseJsonWithPosition } from './json-position'

export type LoadError = {
  file: string
  line?: number
  col?: number
  message: string
  excerpt?: string
}

export type LoadedEndpoint = {
  id: string
  method: HttpMethod
  path: string
  description?: string
  default: string
  responses: Record<string, MockResponse>
  file: string
  line: number
}

export type LoadResult = {
  endpoints: LoadedEndpoint[]
  scenarios: Scenarios
  errors: LoadError[]
  source: 'dir' | 'file' | 'none'
}

export const SCENARIOS_FILENAME = 'scenarios.json'

export function loadMocks(options: { root: string; dir: string; file: string }): LoadResult {
  const { root, dir, file } = options
  const dirPath = join(root, dir)
  const filePath = join(root, file)

  if (existsSync(dirPath) && statSync(dirPath).isDirectory()) {
    return loadFromFiles(root, collectJsonFiles(dirPath), 'dir')
  }

  if (existsSync(filePath)) {
    return loadFromFiles(root, [filePath], 'file')
  }

  return { endpoints: [], scenarios: {}, errors: [], source: 'none' }
}

/** Recorre la carpeta saltando dotfiles y dotdirs, en orden alfabético estable. */
function collectJsonFiles(dirPath: string): string[] {
  const found: string[] = []

  for (const entry of readdirSync(dirPath, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    if (entry.name.startsWith('.')) continue
    const full = join(dirPath, entry.name)

    if (entry.isDirectory()) found.push(...collectJsonFiles(full))
    else if (entry.name.endsWith('.json')) found.push(full)
  }

  return found
}

function loadFromFiles(root: string, paths: string[], source: 'dir' | 'file'): LoadResult {
  const endpoints: LoadedEndpoint[] = []
  const errors: LoadError[] = []
  let scenarios: Scenarios = {}

  for (const path of paths) {
    const displayPath = relative(root, path)
    const raw = readFileSync(path, 'utf8')
    const parsed = parseJsonWithPosition(raw)

    // Un error de parseo invalida el archivo entero: no hay nada que rescatar.
    if (!parsed.ok) {
      errors.push({
        file: displayPath,
        line: parsed.line,
        col: parsed.col,
        message: parsed.message,
        excerpt: parsed.excerpt,
      })
      continue
    }

    if (path.endsWith(SCENARIOS_FILENAME)) {
      const result = ScenariosSchema.safeParse(parsed.value)
      if (result.success) scenarios = { ...scenarios, ...result.data }
      else errors.push({ file: displayPath, message: formatZodMessage(result.error.issues) })
      continue
    }

    if (typeof parsed.value !== 'object' || parsed.value === null || Array.isArray(parsed.value)) {
      errors.push({ file: displayPath, message: 'a mock file must be a JSON object of "METHOD /path" keys' })
      continue
    }

    // Validación por clave, para que un endpoint inválido no tumbe a sus vecinos.
    for (const [key, definition] of Object.entries(parsed.value as Record<string, unknown>)) {
      const line = findKeyLine(raw, key)
      const parsedKey = parseEndpointKey(key)

      if (!parsedKey.ok) {
        errors.push({ file: displayPath, line, message: parsedKey.error })
        continue
      }

      const validated = EndpointSchema.safeParse(definition)
      if (!validated.success) {
        errors.push({
          file: displayPath,
          line,
          message: `${key}: ${formatZodMessage(validated.error.issues)}`,
        })
        continue
      }

      endpoints.push({
        id: formatEndpointId(parsedKey.value.method, parsedKey.value.path),
        method: parsedKey.value.method,
        path: parsedKey.value.path,
        description: validated.data.description,
        default: validated.data.default,
        responses: validated.data.responses,
        file: displayPath,
        line,
      })
    }
  }

  return { endpoints, scenarios, errors, source }
}

function formatZodMessage(issues: readonly { path: PropertyKey[]; message: string }[]): string {
  return issues
    .map((issue) => (issue.path.length > 0 ? `${issue.path.join('.')}: ${issue.message}` : issue.message))
    .join('; ')
}

/** Localiza la línea donde se declara una clave, para el mensaje de error. */
function findKeyLine(source: string, key: string): number {
  const index = source.indexOf(JSON.stringify(key))
  if (index < 0) return 1
  return source.slice(0, index).split('\n').length
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `bun run test -- loader`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): load mock files with per-file and per-endpoint fault tolerance"
```

---

## Task 7: `packages/core` — tabla de rutas y detección de colisiones

Es la contrapartida del ADR-0008: como los archivos ya no impiden la colisión, la detección tiene que estar y ser ruidosa. Sin este test, el ADR-0008 es peor que la decisión que reemplazó.

> **Limitación conocida:** dos claves idénticas **dentro del mismo archivo** las
> deduplica `JSON.parse` en silencio (gana la última) antes de que el loader las
> vea — es inherente a JSON. La detección de acá aplica entre archivos.
> Documentar la limitación en el Plan 5.

**Files:**

- Create: `packages/core/src/route-table.ts`, `packages/core/src/route-table.test.ts`

**Interfaces:**

- Consumes: `LoadedEndpoint`, `LoadError` (Tarea 6)
- Produces: `type RouteTable = { endpoints: LoadedEndpoint[]; byId: Map<string, LoadedEndpoint> }`, `buildRouteTable(endpoints: LoadedEndpoint[]): { table: RouteTable; errors: LoadError[] }`

- [ ] **Step 1: Escribir el test que falla**

```ts
// packages/core/src/route-table.test.ts
import { describe, expect, it } from 'vitest'
import type { LoadedEndpoint } from './loader'
import { buildRouteTable } from './route-table'

function endpoint(id: string, file: string, line = 1): LoadedEndpoint {
  const [method = 'GET', path = '/'] = id.split(' ')
  return {
    id,
    method: method as LoadedEndpoint['method'],
    path,
    default: 'ok',
    responses: { ok: { status: 200 } },
    file,
    line,
  }
}

describe('buildRouteTable', () => {
  it('indexes endpoints by id', () => {
    const { table, errors } = buildRouteTable([
      endpoint('GET /users', 'laqi/api.json'),
      endpoint('POST /users', 'laqi/api.json'),
    ])
    expect(errors).toEqual([])
    expect(table.byId.get('GET /users')?.path).toBe('/users')
    expect(table.endpoints).toHaveLength(2)
  })

  it('allows the same path under different methods', () => {
    const { errors } = buildRouteTable([
      endpoint('GET /users', 'laqi/api.json'),
      endpoint('DELETE /users', 'laqi/other.json'),
    ])
    expect(errors).toEqual([])
  })

  it('reports a duplicate route naming both files and lines', () => {
    const { errors } = buildRouteTable([
      endpoint('GET /users', 'laqi/api.json', 2),
      endpoint('GET /users', 'laqi/orders.json', 14),
    ])
    expect(errors).toHaveLength(1)
    const message = errors[0]?.message ?? ''
    expect(message).toContain('duplicate route')
    expect(message).toContain('GET /users')
    expect(message).toContain('laqi/api.json:2')
    expect(message).toContain('laqi/orders.json:14')
  })

  it('registers neither side of a collision, so the failure is impossible to miss', () => {
    const { table } = buildRouteTable([
      endpoint('GET /users', 'laqi/api.json', 2),
      endpoint('GET /users', 'laqi/orders.json', 14),
    ])
    expect(table.byId.has('GET /users')).toBe(false)
    expect(table.endpoints).toEqual([])
  })

  it('keeps unaffected endpoints when another pair collides', () => {
    const { table } = buildRouteTable([
      endpoint('GET /users', 'laqi/api.json'),
      endpoint('GET /users', 'laqi/orders.json'),
      endpoint('GET /health', 'laqi/api.json'),
    ])
    expect(table.endpoints.map((e) => e.id)).toEqual(['GET /health'])
  })

  it('reports a triple collision once, naming all three', () => {
    const { errors } = buildRouteTable([
      endpoint('GET /users', 'a.json', 1),
      endpoint('GET /users', 'b.json', 2),
      endpoint('GET /users', 'c.json', 3),
    ])
    expect(errors).toHaveLength(1)
    expect(errors[0]?.message).toContain('c.json:3')
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `bun run test -- route-table`
Expected: FAIL — `Failed to resolve import "./route-table"`

- [ ] **Step 3: Implementar**

```ts
// packages/core/src/route-table.ts
import type { LoadedEndpoint, LoadError } from './loader'

export type RouteTable = {
  /** En orden de archivo — el panel depende de que sea estable. */
  endpoints: LoadedEndpoint[]
  byId: Map<string, LoadedEndpoint>
}

export function buildRouteTable(endpoints: LoadedEndpoint[]): {
  table: RouteTable
  errors: LoadError[]
} {
  const grouped = new Map<string, LoadedEndpoint[]>()

  for (const endpoint of endpoints) {
    const existing = grouped.get(endpoint.id)
    if (existing) existing.push(endpoint)
    else grouped.set(endpoint.id, [endpoint])
  }

  const kept: LoadedEndpoint[] = []
  const errors: LoadError[] = []

  for (const [id, group] of grouped) {
    const [first] = group

    if (group.length === 1 && first) {
      kept.push(first)
      continue
    }

    // Ninguno gana: elegir uno sería adivinar, y el desarrollador no vería cuál.
    const where = group.map((e) => `${e.file}:${e.line}`).join(' and ')
    errors.push({
      file: first?.file ?? '',
      line: first?.line,
      message: `duplicate route ${id} declared in ${where}. Neither is served — remove or rename one.`,
    })
  }

  kept.sort((a, b) => endpoints.indexOf(a) - endpoints.indexOf(b))

  return {
    table: { endpoints: kept, byId: new Map(kept.map((e) => [e.id, e])) },
    errors,
  }
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `bun run test -- route-table`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): build route table and reject duplicate routes loudly"
```

---

## Task 8: `packages/core` — store de estado

Escribe `.laqi/state.json`, gitignored ([ADR-0004](/decisions/0004-state-outside-git/)). Es un archivo que genera la máquina: si está corrupto se descarta y se empieza de cero, nunca se cae el servidor.

**Files:**

- Create: `packages/core/src/state-store.ts`, `packages/core/src/state-store.test.ts`

**Interfaces:**

- Consumes: `StateSchema`, `DEFAULT_STATE`, `LaqiState` (Tarea 4)
- Produces: `STATE_DIR = '.laqi'`, `class StateStore { constructor(root: string); read(): LaqiState; write(state: LaqiState): void; path: string }`

- [ ] **Step 1: Escribir el test que falla**

```ts
// packages/core/src/state-store.test.ts
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { StateStore } from './state-store'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'laqi-state-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('StateStore', () => {
  it('returns the default state when nothing has been written', () => {
    expect(new StateStore(root).read()).toEqual({ scenario: null, overrides: {} })
  })

  it('round-trips a state', () => {
    const store = new StateStore(root)
    store.write({ scenario: 'checkout-broken', overrides: { 'GET /users': 'boom' } })
    expect(store.read()).toEqual({
      scenario: 'checkout-broken',
      overrides: { 'GET /users': 'boom' },
    })
  })

  it('creates the .laqi directory on write', () => {
    const store = new StateStore(root)
    store.write({ scenario: null, overrides: { 'GET /a': 'b' } })
    expect(store.path).toContain('.laqi')
    expect(readFileSync(store.path, 'utf8')).toContain('GET /a')
  })

  it('falls back to the default state when the file is corrupt', () => {
    mkdirSync(join(root, '.laqi'), { recursive: true })
    writeFileSync(join(root, '.laqi', 'state.json'), 'not json', 'utf8')
    expect(new StateStore(root).read()).toEqual({ scenario: null, overrides: {} })
  })

  it('falls back when the file parses but has the wrong shape', () => {
    mkdirSync(join(root, '.laqi'), { recursive: true })
    writeFileSync(join(root, '.laqi', 'state.json'), '{"overrides": 42}', 'utf8')
    expect(new StateStore(root).read()).toEqual({ scenario: null, overrides: {} })
  })

  it('writes formatted JSON so a human can read it', () => {
    const store = new StateStore(root)
    store.write({ scenario: null, overrides: { 'GET /a': 'b' } })
    expect(readFileSync(store.path, 'utf8')).toContain('\n')
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `bun run test -- state-store`
Expected: FAIL — `Failed to resolve import "./state-store"`

- [ ] **Step 3: Implementar**

```ts
// packages/core/src/state-store.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DEFAULT_STATE, StateSchema, type LaqiState } from '@laqi/schema'

export const STATE_DIR = '.laqi'
export const STATE_FILE = 'state.json'

export class StateStore {
  readonly path: string

  constructor(root: string) {
    this.path = join(root, STATE_DIR, STATE_FILE)
  }

  /**
   * Lo genera la máquina, así que cualquier daño se descarta en silencio:
   * perder el estado de una sesión es preferible a no arrancar.
   */
  read(): LaqiState {
    if (!existsSync(this.path)) return { ...DEFAULT_STATE }

    try {
      const parsed = StateSchema.safeParse(JSON.parse(readFileSync(this.path, 'utf8')))
      return parsed.success ? parsed.data : { ...DEFAULT_STATE }
    } catch {
      return { ...DEFAULT_STATE }
    }
  }

  write(state: LaqiState): void {
    mkdirSync(dirname(this.path), { recursive: true })
    writeFileSync(this.path, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  }
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `bun run test -- state-store`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): persist active state in gitignored .laqi/state.json"
```

---

## Task 9: `packages/core` — resolución de las cuatro capas

El corazón del producto. Ver [`docs/diseno/STATE-MODEL.md`](/design/state-model/).

**Files:**

- Create: `packages/core/src/resolve.ts`, `packages/core/src/resolve.test.ts`, `packages/core/src/index.ts`
- Modify: `docs/conceptos/resolucion-de-estado.md`

**Interfaces:**

- Consumes: `LoadedEndpoint` (Tarea 6), `LaqiState`, `Scenarios`, `MockResponse` (Tarea 4)
- Produces:
  - `type Layer = 'header' | 'state' | 'scenario' | 'default'`
  - `type Resolution = { ok: true; name: string; layer: Layer; response: MockResponse } | { ok: false; name: string; layer: Layer; message: string }`
  - `resolveResponse(input: { endpoint: LoadedEndpoint; state: LaqiState; scenarios: Scenarios; headerResponse?: string; headerScenario?: string }): Resolution`
  - `formatResolvedHeader(resolution: Resolution): string`

- [ ] **Step 1: Escribir el test que falla**

```ts
// packages/core/src/resolve.test.ts
import { describe, expect, it } from 'vitest'
import type { LoadedEndpoint } from './loader'
import { formatResolvedHeader, resolveResponse } from './resolve'

const endpoint: LoadedEndpoint = {
  id: 'GET /users',
  method: 'GET',
  path: '/users',
  default: 'ok',
  responses: {
    ok: { status: 200, body: [] },
    empty: { status: 200, body: [] },
    boom: { status: 500, body: { code: 'INTERNAL' } },
  },
  file: 'laqi/api.json',
  line: 2,
}

const scenarios = {
  'checkout-broken': { 'GET /users': 'boom' },
  'new-user': { 'GET /users': 'empty' },
}

const empty = { scenario: null, overrides: {} }

describe('resolveResponse precedence', () => {
  it('falls back to the file default', () => {
    const r = resolveResponse({ endpoint, state: empty, scenarios })
    expect(r).toMatchObject({ ok: true, name: 'ok', layer: 'default' })
  })

  it('uses the active scenario over the default', () => {
    const r = resolveResponse({
      endpoint,
      state: { scenario: 'checkout-broken', overrides: {} },
      scenarios,
    })
    expect(r).toMatchObject({ ok: true, name: 'boom', layer: 'scenario' })
  })

  it('uses a per-endpoint override over the scenario', () => {
    const r = resolveResponse({
      endpoint,
      state: { scenario: 'checkout-broken', overrides: { 'GET /users': 'empty' } },
      scenarios,
    })
    expect(r).toMatchObject({ ok: true, name: 'empty', layer: 'state' })
  })

  it('uses the request header over everything', () => {
    const r = resolveResponse({
      endpoint,
      state: { scenario: 'checkout-broken', overrides: { 'GET /users': 'empty' } },
      scenarios,
      headerResponse: 'ok',
    })
    expect(r).toMatchObject({ ok: true, name: 'ok', layer: 'header' })
  })

  it('reports layer "header" for a header-supplied scenario, because it persists nothing', () => {
    const r = resolveResponse({ endpoint, state: empty, scenarios, headerScenario: 'new-user' })
    expect(r).toMatchObject({ ok: true, name: 'empty', layer: 'header' })
  })

  it('ignores an active scenario that does not cover this endpoint', () => {
    const r = resolveResponse({
      endpoint,
      state: { scenario: 'unrelated', overrides: {} },
      scenarios: { unrelated: { 'GET /other': 'boom' } },
    })
    expect(r).toMatchObject({ ok: true, name: 'ok', layer: 'default' })
  })

  it('ignores a scenario name that does not exist', () => {
    const r = resolveResponse({ endpoint, state: { scenario: 'ghost', overrides: {} }, scenarios })
    expect(r).toMatchObject({ ok: true, name: 'ok', layer: 'default' })
  })

  it('returns the resolved response object', () => {
    const r = resolveResponse({ endpoint, state: empty, scenarios, headerResponse: 'boom' })
    expect(r.ok && r.response.status).toBe(500)
  })
})

describe('resolveResponse failure', () => {
  it('fails loudly when a header names a response that does not exist', () => {
    const r = resolveResponse({ endpoint, state: empty, scenarios, headerResponse: 'ghost' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.message).toContain('ghost')
    expect(r.message).toContain('ok')
    expect(r.layer).toBe('header')
  })

  it('fails loudly when an override names a response that does not exist', () => {
    const r = resolveResponse({
      endpoint,
      state: { scenario: null, overrides: { 'GET /users': 'ghost' } },
      scenarios,
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.layer).toBe('state')
  })

  it('rejects a prototype-chain name like "toString" instead of serving garbage', () => {
    const r = resolveResponse({ endpoint, state: empty, scenarios, headerResponse: 'toString' })
    expect(r.ok).toBe(false)
  })
})

describe('formatResolvedHeader', () => {
  it('renders "<name> (<layer>)" exactly as the panel prints it', () => {
    const r = resolveResponse({ endpoint, state: empty, scenarios })
    expect(formatResolvedHeader(r)).toBe('ok (default)')
  })

  it('renders the state layer', () => {
    const r = resolveResponse({
      endpoint,
      state: { scenario: null, overrides: { 'GET /users': 'boom' } },
      scenarios,
    })
    expect(formatResolvedHeader(r)).toBe('boom (state)')
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `bun run test -- resolve`
Expected: FAIL — `Failed to resolve import "./resolve"`

- [ ] **Step 3: Implementar**

```ts
// packages/core/src/resolve.ts
import type { LaqiState, MockResponse, Scenarios } from '@laqi/schema'
import type { LoadedEndpoint } from './loader'

/** Las cuatro únicas palabras de capa. El panel mapea cada una a un color. */
export type Layer = 'header' | 'state' | 'scenario' | 'default'

export type Resolution =
  | { ok: true; name: string; layer: Layer; response: MockResponse }
  | { ok: false; name: string; layer: Layer; message: string }

export function resolveResponse(input: {
  endpoint: LoadedEndpoint
  state: LaqiState
  scenarios: Scenarios
  headerResponse?: string
  headerScenario?: string
}): Resolution {
  const { endpoint, state, scenarios, headerResponse, headerScenario } = input
  const { name, layer } = selectName()

  // Object.hasOwn: "toString" u otra clave heredada del prototipo no es una
  // respuesta declarada, aunque `responses[name]` devuelva algo truthy.
  const response = Object.hasOwn(endpoint.responses, name) ? endpoint.responses[name] : undefined
  if (!response) {
    return {
      ok: false,
      name,
      layer,
      message: `response ${JSON.stringify(name)} is not declared on ${endpoint.id}. Available: ${Object.keys(endpoint.responses).join(', ')}`,
    }
  }

  return { ok: true, name, layer, response }

  function selectName(): { name: string; layer: Layer } {
    // 1. Header explícito. No persiste nada.
    if (headerResponse) return { name: headerResponse, layer: 'header' }

    // 2. Escenario pedido por header: también capa `header`, por lo mismo.
    if (headerScenario) {
      const fromHeaderScenario = scenarios[headerScenario]?.[endpoint.id]
      if (fromHeaderScenario) return { name: fromHeaderScenario, layer: 'header' }
    }

    // 3. Override por endpoint, escrito por el panel o el MCP.
    const override = state.overrides[endpoint.id]
    if (override) return { name: override, layer: 'state' }

    // 4. Escenario activo — más general que un override, por eso va después.
    if (state.scenario) {
      const fromScenario = scenarios[state.scenario]?.[endpoint.id]
      if (fromScenario) return { name: fromScenario, layer: 'scenario' }
    }

    // 5. La baseline del archivo.
    return { name: endpoint.default, layer: 'default' }
  }
}

/** El valor exacto de `X-Laqi-Resolved`. El log del panel lo imprime verbatim. */
export function formatResolvedHeader(resolution: Resolution): string {
  return `${resolution.name} (${resolution.layer})`
}
```

```ts
// packages/core/src/index.ts
export * from './json-position'
export * from './loader'
export * from './route-table'
export * from './state-store'
export * from './resolve'
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `bun run test -- resolve`
Expected: PASS, 13 tests.

- [ ] **Step 5: Corregir el documento del concepto**

En `docs/conceptos/resolucion-de-estado.md`, reemplazar la línea del algoritmo

```
    si request tiene X-Laqi-Scenario  -> la del escenario,    origen "scenario:<n>"
```

por

```
    si request tiene X-Laqi-Scenario  -> la del escenario,    origen "header"
```

y añadir debajo del bloque de código:

```markdown
> Las palabras de capa son exactamente cuatro: `header`, `state`, `scenario` y
> `default`. Un escenario pedido por header reporta `header`, no `scenario`,
> porque no persiste nada — y porque el panel mapea cada palabra a un color.
```

- [ ] **Step 6: Commit**

```bash
git add packages/core docs/conceptos/resolucion-de-estado.md
git commit -m "feat(core): resolve the live response across the four layers"
```

---

## Task 10: `packages/server` — servir los mocks

**Files:**

- Create: `packages/server/package.json`, `packages/server/tsconfig.json`, `packages/server/src/mock-app.ts`, `packages/server/src/mock-app.test.ts`, `packages/server/src/index.ts`

**Interfaces:**

- Consumes: `RouteTable`, `resolveResponse`, `formatResolvedHeader` (Tareas 7, 9); `LaqiState`, `Scenarios`, `LaqiConfig` (Tarea 4)
- Produces: `type MockRuntime = { table: RouteTable; scenarios: Scenarios; getState: () => LaqiState; cors: LaqiConfig['cors'] }`, `createMockApp(runtime: MockRuntime): Hono`

**Restricción:** este archivo no puede importar nada de `node:`. Es lo que lo hace desplegable a Cloudflare Workers en el Plan 4.

- [ ] **Step 1: `package.json` y `tsconfig.json`**

```json
{
  "name": "@laqi/server",
  "version": "2.0.0",
  "type": "module",
  "exports": { ".": "./src/index.ts", "./package.json": "./package.json" },
  "dependencies": {
    "@laqi/core": "workspace:*",
    "@laqi/schema": "workspace:*",
    "hono": "catalog:"
  },
  "scripts": { "check-types": "tsc --noEmit -p ." }
}
```

```json
{ "extends": "../config/tsconfig.base.json", "include": ["src/**/*"] }
```

- [ ] **Step 2: Escribir el test que falla**

```ts
// packages/server/src/mock-app.test.ts
import { buildRouteTable, type LoadedEndpoint } from '@laqi/core'
import type { LaqiState, Scenarios } from '@laqi/schema'
import { describe, expect, it } from 'vitest'
import { createMockApp, type MockRuntime } from './mock-app'

const endpoints: LoadedEndpoint[] = [
  {
    id: 'GET /users',
    method: 'GET',
    path: '/users',
    default: 'ok',
    responses: {
      ok: { status: 200, body: { items: [{ id: 1 }] } },
      slow: { status: 200, delay: 60, body: { items: [] } },
      boom: { status: 500, body: { code: 'INTERNAL' } },
      custom: { status: 200, body: {}, headers: { 'x-custom': 'yes' } },
    },
    file: 'laqi/api.json',
    line: 2,
  },
  {
    id: 'DELETE /users/:id',
    method: 'DELETE',
    path: '/users/:id',
    default: 'gone',
    responses: { gone: { status: 204 } },
    file: 'laqi/api.json',
    line: 10,
  },
]

function makeApp(state: LaqiState = { scenario: null, overrides: {} }, scenarios: Scenarios = {}) {
  const { table } = buildRouteTable(endpoints)
  const runtime: MockRuntime = { table, scenarios, getState: () => state, cors: '*' }
  return createMockApp(runtime)
}

describe('createMockApp', () => {
  it('serves the default response', async () => {
    const res = await makeApp().request('/users')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ items: [{ id: 1 }] })
  })

  it('sets X-Laqi-Resolved on every response', async () => {
    const res = await makeApp().request('/users')
    expect(res.headers.get('X-Laqi-Resolved')).toBe('ok (default)')
  })

  it('serves the status declared on the response', async () => {
    const state: LaqiState = { scenario: null, overrides: { 'GET /users': 'boom' } }
    const res = await makeApp(state).request('/users')
    expect(res.status).toBe(500)
    expect(res.headers.get('X-Laqi-Resolved')).toBe('boom (state)')
  })

  it('serves a 204 with no body', async () => {
    const res = await makeApp().request('/users/42', { method: 'DELETE' })
    expect(res.status).toBe(204)
    expect(await res.text()).toBe('')
  })

  it('applies custom headers', async () => {
    const state: LaqiState = { scenario: null, overrides: { 'GET /users': 'custom' } }
    const res = await makeApp(state).request('/users')
    expect(res.headers.get('x-custom')).toBe('yes')
  })

  it('honours delay', async () => {
    const state: LaqiState = { scenario: null, overrides: { 'GET /users': 'slow' } }
    const started = Date.now()
    await makeApp(state).request('/users')
    expect(Date.now() - started).toBeGreaterThanOrEqual(50)
  })

  it('matches path params', async () => {
    const res = await makeApp().request('/users/42', { method: 'DELETE' })
    expect(res.status).toBe(204)
  })

  it('does not answer a method it was not declared for', async () => {
    const res = await makeApp().request('/users', { method: 'PATCH' })
    expect(res.status).toBe(404)
  })

  it('never mutates the loaded body between requests (v1 defect A)', async () => {
    const app = makeApp()
    const first = await (await app.request('/users?leak=SECRET')).json()
    const second = await (await app.request('/users')).json()

    expect(second).toEqual({ items: [{ id: 1 }] })
    expect(second).toEqual(first)
    expect(endpoints[0]?.responses.ok?.body).toEqual({ items: [{ id: 1 }] })
  })

  it('returns 500 with a clear message instead of hanging on a bad selector (v1 defect C)', async () => {
    const state: LaqiState = { scenario: null, overrides: { 'GET /users': 'ghost' } }
    const res = await makeApp(state).request('/users')
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).toContain('ghost')
    expect(res.headers.get('X-Laqi-Resolved')).toBe('ghost (state)')
  })
})
```

- [ ] **Step 3: Correr el test y verificar que falla**

Run: `bun run test -- mock-app`
Expected: FAIL — `Failed to resolve import "./mock-app"`

- [ ] **Step 4: Implementar**

```ts
// packages/server/src/mock-app.ts
import { formatResolvedHeader, resolveResponse, type RouteTable } from '@laqi/core'
import type { LaqiConfig, LaqiState, Scenarios } from '@laqi/schema'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { ContentfulStatusCode, StatusCode } from 'hono/utils/http-status'

export type MockRuntime = {
  table: RouteTable
  scenarios: Scenarios
  /** Función, no valor: el estado cambia sin que cambie la tabla de rutas. */
  getState: () => LaqiState
  cors: LaqiConfig['cors']
}

export const RESPONSE_HEADER = 'X-Laqi-Response'
export const SCENARIO_HEADER = 'X-Laqi-Scenario'
export const RESOLVED_HEADER = 'X-Laqi-Resolved'

export function createMockApp(runtime: MockRuntime): Hono {
  const app = new Hono()

  app.use(
    '*',
    cors({
      origin: runtime.cors === '*' ? '*' : runtime.cors,
      allowHeaders: ['Content-Type', 'Authorization', RESPONSE_HEADER, SCENARIO_HEADER],
      exposeHeaders: [RESOLVED_HEADER],
    }),
  )

  for (const endpoint of runtime.table.endpoints) {
    app.on(endpoint.method, endpoint.path, async (c) => {
      const resolution = resolveResponse({
        endpoint,
        state: runtime.getState(),
        scenarios: runtime.scenarios,
        headerResponse: c.req.header(RESPONSE_HEADER),
        headerScenario: c.req.header(SCENARIO_HEADER),
      })

      c.header(RESOLVED_HEADER, formatResolvedHeader(resolution))

      // Un selector inexistente es un 500 explícito. Jamás una request colgada.
      if (!resolution.ok) {
        return c.json({ error: 'laqi', endpoint: endpoint.id, message: resolution.message }, 500)
      }

      const { response } = resolution

      if (response.delay) {
        await new Promise((resolve) => setTimeout(resolve, response.delay))
      }

      for (const [name, value] of Object.entries(response.headers ?? {})) {
        c.header(name, value)
      }

      if (response.body === undefined) {
        return c.body(null, response.status as StatusCode)
      }

      // structuredClone: el cuerpo servido nunca es la referencia cargada.
      return c.json(structuredClone(response.body), response.status as ContentfulStatusCode)
    })
  }

  return app
}
```

```ts
// packages/server/src/index.ts
export * from './mock-app'
```

- [ ] **Step 5: Correr el test y verificar que pasa**

Run: `bun run test -- mock-app`
Expected: PASS, 10 tests. El test `does not answer a method it was not declared for` pasa porque Hono devuelve 404 por defecto; la Tarea 11 le da cuerpo a esa respuesta.

- [ ] **Step 6: Commit**

```bash
git add packages/server
git commit -m "feat(server): serve mocks over Hono with immutable bodies and resolution header"
```

---

## Task 11: `packages/server` — overrides por header y 404 con explicación

El 404 sin ruta es la confusión número uno del producto (flujo F3), así que tiene que explicarse solo.

**Files:**

- Modify: `packages/server/src/mock-app.ts`
- Create: `packages/server/src/no-route.test.ts`

**Interfaces:**

- Consumes: lo de la Tarea 10
- Produces: sin exports nuevos; `createMockApp` gana el handler catch-all

- [ ] **Step 1: Escribir el test que falla**

```ts
// packages/server/src/no-route.test.ts
import { buildRouteTable, type LoadedEndpoint } from '@laqi/core'
import { describe, expect, it } from 'vitest'
import { createMockApp } from './mock-app'

const endpoints: LoadedEndpoint[] = [
  {
    id: 'GET /users',
    method: 'GET',
    path: '/users',
    default: 'ok',
    responses: { ok: { status: 200, body: [] }, boom: { status: 500, body: {} } },
    file: 'laqi/api.json',
    line: 2,
  },
]

const scenarios = { 'checkout-broken': { 'GET /users': 'boom' } }

function makeApp() {
  const { table } = buildRouteTable(endpoints)
  return createMockApp({
    table,
    scenarios,
    getState: () => ({ scenario: null, overrides: {} }),
    cors: '*',
  })
}

describe('X-Laqi-Response', () => {
  it('overrides for this request only', async () => {
    const app = makeApp()
    const overridden = await app.request('/users', { headers: { 'X-Laqi-Response': 'boom' } })
    expect(overridden.status).toBe(500)
    expect(overridden.headers.get('X-Laqi-Resolved')).toBe('boom (header)')

    const untouched = await app.request('/users')
    expect(untouched.status).toBe(200)
    expect(untouched.headers.get('X-Laqi-Resolved')).toBe('ok (default)')
  })
})

describe('X-Laqi-Scenario', () => {
  it('applies a scenario to one request and reports the header layer', async () => {
    const res = await makeApp().request('/users', {
      headers: { 'X-Laqi-Scenario': 'checkout-broken' },
    })
    expect(res.status).toBe(500)
    expect(res.headers.get('X-Laqi-Resolved')).toBe('boom (header)')
  })
})

describe('no matching route', () => {
  it('returns 404 naming the method and path', async () => {
    const res = await makeApp().request('/typo')
    expect(res.status).toBe(404)

    const body = (await res.json()) as { error: string; message: string; method: string; path: string }
    expect(body.error).toBe('laqi')
    expect(body.message).toContain('no matching route')
    expect(body.method).toBe('GET')
    expect(body.path).toBe('/typo')
  })

  it('lists what is available, so the typo is obvious', async () => {
    const body = (await (await makeApp().request('/usres')).json()) as { available: string[] }
    expect(body.available).toContain('GET /users')
  })

  it('caps the available list so a hundred endpoints do not flood the response', async () => {
    const many: LoadedEndpoint[] = Array.from({ length: 60 }, (_, i) => ({
      id: `GET /r${i}`,
      method: 'GET' as const,
      path: `/r${i}`,
      default: 'ok',
      responses: { ok: { status: 200, body: {} } },
      file: 'laqi/api.json',
      line: i + 1,
    }))
    const { table } = buildRouteTable(many)
    const app = createMockApp({
      table,
      scenarios: {},
      getState: () => ({ scenario: null, overrides: {} }),
      cors: '*',
    })

    const body = (await (await app.request('/nope')).json()) as { available: string[] }
    expect(body.available.length).toBeLessThanOrEqual(20)
  })

  it('answers a no-route request for any method', async () => {
    expect((await makeApp().request('/typo', { method: 'POST' })).status).toBe(404)
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `bun run test -- no-route`
Expected: FAIL — los tests de `X-Laqi-Response` pasan (ya implementado en la Tarea 10), los de `no matching route` fallan porque el 404 de Hono no trae cuerpo JSON.

- [ ] **Step 3: Implementar**

En `packages/server/src/mock-app.ts`, añadir antes del `return app`:

```ts
  /** Cap de rutas listadas: útil para un typo, inmanejable con cien endpoints. */
  const MAX_SUGGESTIONS = 20

  app.all('*', (c) =>
    c.json(
      {
        error: 'laqi',
        message: 'no matching route',
        method: c.req.method,
        path: new URL(c.req.url).pathname,
        available: runtime.table.endpoints.slice(0, MAX_SUGGESTIONS).map((e) => e.id),
        totalEndpoints: runtime.table.endpoints.length,
      },
      404,
    ),
  )
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `bun run test -- no-route mock-app`
Expected: PASS, todos.

- [ ] **Step 5: Commit**

```bash
git add packages/server
git commit -m "feat(server): explain no-matching-route with method, path and suggestions"
```

---

## Task 12: `apps/cli` — servir con recarga en caliente

Arregla el defecto H de v1 y el hallazgo H6: el proceso y el socket **nunca** se reinician. Sólo se reemplaza la app Hono detrás del handler. Si el servidor se reiniciara, en el Plan 2 se cortaría el SSE y el panel quedaría en blanco en cada guardado.

**Files:**

- Create: `apps/cli/package.json`, `apps/cli/tsconfig.json`, `apps/cli/src/runtime.ts`, `apps/cli/src/serve.ts`, `apps/cli/src/watcher.ts`, `apps/cli/src/serve.test.ts`, `apps/cli/src/watcher.test.ts`, `apps/cli/src/index.ts`

**Interfaces:**

- Consumes: `loadMocks`, `buildRouteTable`, `StateStore` (Tareas 6–8); `createMockApp` (Tarea 10); `ConfigSchema` (Tarea 4)
- Produces:
  - `type Runtime = { table: RouteTable; scenarios: Scenarios; errors: LoadError[]; source: LoadResult['source'] }`
  - `buildRuntime(root: string, config: LaqiConfig): Runtime`
  - `type ServeHandle = { port: number; host: string; reload: () => Runtime; current: () => Runtime; close: () => Promise<void> }`
  - `startServer(options: { root: string; config: LaqiConfig }): Promise<ServeHandle>`
  - `watchMocks(options: { paths: string[]; onChange: () => void; debounceMs?: number }): { close: () => Promise<void> }`

- [ ] **Step 1: `package.json` y `tsconfig.json`**

```json
{
  "name": "@laqi/cli",
  "version": "2.0.0",
  "type": "module",
  "bin": { "laqi": "./src/index.ts" },
  "dependencies": {
    "@hono/node-server": "^1.19.7",
    "@laqi/core": "workspace:*",
    "@laqi/schema": "workspace:*",
    "@laqi/server": "workspace:*",
    "chokidar": "^4.0.3",
    "hono": "catalog:"
  },
  "scripts": { "check-types": "tsc --noEmit -p ." }
}
```

```json
{
  "extends": "../../packages/config/tsconfig.base.json",
  "compilerOptions": { "types": ["node"] },
  "include": ["src/**/*"]
}
```

- [ ] **Step 2: Escribir el test que falla**

```ts
// apps/cli/src/serve.test.ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConfigSchema } from '@laqi/schema'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { startServer, type ServeHandle } from './serve'

let root: string
let handle: ServeHandle | undefined

const config = ConfigSchema.parse({ port: 0, host: '127.0.0.1' })

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'laqi-serve-'))
  mkdirSync(join(root, 'laqi'), { recursive: true })
})

afterEach(async () => {
  await handle?.close()
  handle = undefined
  rmSync(root, { recursive: true, force: true })
})

function writeMocks(contents: Record<string, unknown>) {
  writeFileSync(join(root, 'laqi', 'api.json'), JSON.stringify(contents), 'utf8')
}

const get = (path: string) => fetch(`http://127.0.0.1:${handle?.port}${path}`)

describe('startServer', () => {
  it('serves a loaded endpoint', async () => {
    writeMocks({ 'GET /users': { default: 'ok', responses: { ok: { status: 200, body: [] } } } })
    handle = await startServer({ root, config })

    const res = await get('/users')
    expect(res.status).toBe(200)
    expect(res.headers.get('X-Laqi-Resolved')).toBe('ok (default)')
  })

  it('starts even with no mock files at all (F9)', async () => {
    handle = await startServer({ root, config })
    expect((await get('/anything')).status).toBe(404)
  })

  it('picks up a new endpoint on reload, on the same port', async () => {
    writeMocks({ 'GET /users': { default: 'ok', responses: { ok: { status: 200, body: [] } } } })
    handle = await startServer({ root, config })
    const port = handle.port

    expect((await get('/orders')).status).toBe(404)

    writeMocks({
      'GET /users': { default: 'ok', responses: { ok: { status: 200, body: [] } } },
      'GET /orders': { default: 'ok', responses: { ok: { status: 200, body: [] } } },
    })
    handle.reload()

    expect(handle.port).toBe(port)
    expect((await get('/orders')).status).toBe(200)
  })

  it('survives rapid consecutive reloads without EADDRINUSE (v1 defect H)', async () => {
    writeMocks({ 'GET /users': { default: 'ok', responses: { ok: { status: 200, body: [] } } } })
    handle = await startServer({ root, config })

    for (let i = 0; i < 10; i++) handle.reload()

    expect((await get('/users')).status).toBe(200)
  })

  it('keeps serving valid files when one is broken (H3)', async () => {
    writeMocks({ 'GET /users': { default: 'ok', responses: { ok: { status: 200, body: [] } } } })
    writeFileSync(join(root, 'laqi', 'broken.json'), '{ nope', 'utf8')
    handle = await startServer({ root, config })

    expect((await get('/users')).status).toBe(200)
    expect(handle.current().errors).toHaveLength(1)
  })

  it('exposes load errors through the handle for the panel to render', async () => {
    writeFileSync(join(root, 'laqi', 'broken.json'), '{\n  "a": 1,\n}\n', 'utf8')
    handle = await startServer({ root, config })

    const [error] = handle.current().errors
    expect(error?.file).toContain('broken.json')
    expect(error?.excerpt).toContain('^')
  })
})
```

```ts
// apps/cli/src/watcher.test.ts
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { watchMocks } from './watcher'

let root: string
let watcher: { close: () => Promise<void> } | undefined

const settle = (ms = 300) => new Promise((resolve) => setTimeout(resolve, ms))

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'laqi-watch-'))
  mkdirSync(join(root, 'laqi'), { recursive: true })
})

afterEach(async () => {
  await watcher?.close()
  watcher = undefined
  rmSync(root, { recursive: true, force: true })
})

describe('watchMocks', () => {
  it('fires when a file changes', async () => {
    const file = join(root, 'laqi', 'api.json')
    writeFileSync(file, '{}', 'utf8')

    let calls = 0
    watcher = watchMocks({ root, dir: 'laqi', file: 'laqi.json', onChange: () => calls++, debounceMs: 20 })
    await settle()

    writeFileSync(file, '{"a":1}', 'utf8')
    await settle()

    expect(calls).toBeGreaterThanOrEqual(1)
  })

  it('fires when a file is added (v1 defect G)', async () => {
    let calls = 0
    watcher = watchMocks({ root, dir: 'laqi', file: 'laqi.json', onChange: () => calls++, debounceMs: 20 })
    await settle()

    writeFileSync(join(root, 'laqi', 'new.json'), '{}', 'utf8')
    await settle()

    expect(calls).toBeGreaterThanOrEqual(1)
  })

  it('fires when a file is deleted (v1 defect G)', async () => {
    const file = join(root, 'laqi', 'api.json')
    writeFileSync(file, '{}', 'utf8')

    let calls = 0
    watcher = watchMocks({ root, dir: 'laqi', file: 'laqi.json', onChange: () => calls++, debounceMs: 20 })
    await settle()

    unlinkSync(file)
    await settle()

    expect(calls).toBeGreaterThanOrEqual(1)
  })

  it('debounces a burst of writes into a single call (v1 defect H)', async () => {
    const file = join(root, 'laqi', 'api.json')
    writeFileSync(file, '{}', 'utf8')

    let calls = 0
    watcher = watchMocks({ root, dir: 'laqi', file: 'laqi.json', onChange: () => calls++, debounceMs: 120 })
    await settle()

    for (let i = 0; i < 5; i++) writeFileSync(file, `{"n":${i}}`, 'utf8')
    await settle(400)

    expect(calls).toBe(1)
  })

  it('detects the mocks folder even when it is created after startup (F9)', async () => {
    const fresh = mkdtempSync(join(tmpdir(), 'laqi-fresh-'))
    let calls = 0
    watcher = watchMocks({ root: fresh, dir: 'laqi', file: 'laqi.json', onChange: () => calls++, debounceMs: 20 })
    await settle()

    mkdirSync(join(fresh, 'laqi'))
    writeFileSync(join(fresh, 'laqi', 'api.json'), '{}', 'utf8')
    await settle(600)

    expect(calls).toBeGreaterThanOrEqual(1)
    rmSync(fresh, { recursive: true, force: true })
  })
})
```

- [ ] **Step 3: Correr los tests y verificar que fallan**

Run: `bun run test -- serve watcher`
Expected: FAIL — imports sin resolver.

- [ ] **Step 4: Implementar**

```ts
// apps/cli/src/runtime.ts
import {
  buildRouteTable,
  loadMocks,
  type LoadError,
  type LoadResult,
  type RouteTable,
} from '@laqi/core'
import type { LaqiConfig, Scenarios } from '@laqi/schema'

export type Runtime = {
  table: RouteTable
  scenarios: Scenarios
  errors: LoadError[]
  source: LoadResult['source']
}

export function buildRuntime(root: string, config: LaqiConfig): Runtime {
  const loaded = loadMocks({ root, dir: config.dir, file: config.file })
  const { table, errors: routeErrors } = buildRouteTable(loaded.endpoints)

  return {
    table,
    scenarios: loaded.scenarios,
    errors: [...loaded.errors, ...routeErrors],
    source: loaded.source,
  }
}
```

```ts
// apps/cli/src/serve.ts
import { serve, type ServerType } from '@hono/node-server'
import { StateStore } from '@laqi/core'
import type { LaqiConfig } from '@laqi/schema'
import { createMockApp } from '@laqi/server'
import type { Hono } from 'hono'
import { buildRuntime, type Runtime } from './runtime'

export type ServeHandle = {
  port: number
  host: string
  /** Reconstruye la app Hono. El proceso y el socket NO se tocan. */
  reload: () => Runtime
  current: () => Runtime
  close: () => Promise<void>
}

export async function startServer(options: {
  root: string
  config: LaqiConfig
}): Promise<ServeHandle> {
  const { root, config } = options
  const store = new StateStore(root)

  let runtime = buildRuntime(root, config)
  let app: Hono = buildApp()

  function buildApp(): Hono {
    return createMockApp({
      table: runtime.table,
      scenarios: runtime.scenarios,
      // Se lee en cada request: el panel cambia el estado sin tocar archivos.
      getState: () => store.read(),
      cors: config.cors,
    })
  }

  const server: ServerType = await new Promise((resolve) => {
    const instance = serve(
      {
        // La indirección es el punto: `app` es mutable, el servidor no.
        fetch: (request: Request) => app.fetch(request),
        port: config.port,
        hostname: config.host,
      },
      () => resolve(instance),
    )
  })

  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : config.port

  return {
    port,
    host: config.host,
    current: () => runtime,
    reload: () => {
      runtime = buildRuntime(root, config)
      app = buildApp()
      return runtime
    },
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      }),
  }
}
```

```ts
// apps/cli/src/watcher.ts
import { relative, sep } from 'node:path'
import { watch, type FSWatcher } from 'chokidar'

export function watchMocks(options: {
  root: string
  dir: string
  file: string
  onChange: () => void
  debounceMs?: number
}): { close: () => Promise<void> } {
  const { root, dir, file, onChange, debounceMs = 60 } = options

  // chokidar 4 no observa rutas que todavía no existen, así que observamos la
  // raíz del proyecto y PODAMOS todo lo que no sea la carpeta o el archivo de
  // mocks. Así un proyecto fresco (F9) detecta `laqi/` cuando se crea, sin
  // indexar src/ ni node_modules.
  const watcher: FSWatcher = watch(root, {
    ignoreInitial: true,
    ignored: (path: string) => {
      if (path === root) return false
      const parts = relative(root, path).split(sep)
      // Los dotfiles incluyen .laqi/state.json, que escribimos nosotros:
      // observarlo sería un bucle de recarga infinito.
      if (parts.some((part) => part.startsWith('.'))) return true
      return parts[0] !== dir && parts[0] !== file
    },
  })

  let timer: ReturnType<typeof setTimeout> | undefined

  // Un guardado dispara varios eventos; sin debounce se recargaría de más.
  const schedule = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(onChange, debounceMs)
  }

  // v1 sólo escuchaba 'change', así que crear o borrar archivos no recargaba.
  watcher.on('add', schedule).on('change', schedule).on('unlink', schedule)

  return {
    close: async () => {
      if (timer) clearTimeout(timer)
      await watcher.close()
    },
  }
}
```

- [ ] **Step 5: Correr los tests y verificar que pasan**

Run: `bun run test -- serve watcher`
Expected: PASS, 11 tests.

- [ ] **Step 6: Escribir el entry point del CLI**

```ts
#!/usr/bin/env node
// apps/cli/src/index.ts — el shebang DEBE quedar como primera línea del archivo
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { ConfigSchema, type LaqiConfig } from '@laqi/schema'
import type { Runtime } from './runtime'
import { startServer } from './serve'
import { watchMocks } from './watcher'

const CONFIG_FILE = 'laqi.config.json'

// NOTA para quien implemente esta tarea: la USAGE de abajo ya anuncia
// `laqi migrate`, pero el comando en sí (el import de `runMigrate` y su
// bloque `if (positionals[0] === 'migrate')`) los añade la Tarea 13, que crea
// `migrate.ts`. Hasta entonces `laqi migrate` cae en el "unknown command" de
// más abajo — es el comportamiento esperado de ESTA tarea, no un bug.
const USAGE = `
laqi — mock server for frontend development

  laqi                 serve the mocks in ./laqi/ or ./laqi.json
  laqi migrate         convert v1 mock files to the v2 format
  laqi --help          show this message

Options:
  --port <number>      port to listen on          (default 8000)
  --host <address>     address to bind            (default 127.0.0.1)
  --dir <path>         mocks folder               (default laqi)
  --file <path>        single mock file           (default laqi.json)
  --dry-run            with migrate: print, do not write
`.trim()

function loadConfig(root: string, overrides: Partial<LaqiConfig>): LaqiConfig {
  const path = join(root, CONFIG_FILE)
  let fromFile: unknown = {}

  if (existsSync(path)) {
    try {
      fromFile = JSON.parse(readFileSync(path, 'utf8'))
    } catch (error) {
      console.error(`✖ ${CONFIG_FILE} is not valid JSON — using defaults`)
      console.error(`  ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const merged = { ...(fromFile as Record<string, unknown>), ...stripUndefined(overrides) }
  const parsed = ConfigSchema.safeParse(merged)

  if (!parsed.success) {
    console.error(`✖ ${CONFIG_FILE} is invalid — using defaults`)
    for (const issue of parsed.error.issues) {
      console.error(`  ${issue.path.join('.')}: ${issue.message}`)
    }
    return ConfigSchema.parse({})
  }

  return parsed.data
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      port: { type: 'string' },
      host: { type: 'string' },
      dir: { type: 'string' },
      file: { type: 'string' },
      'dry-run': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  })

  if (values.help) {
    console.log(USAGE)
    return
  }

  const root = process.cwd()
  const config = loadConfig(root, {
    port: values.port === undefined ? undefined : Number(values.port),
    host: values.host,
    dir: values.dir,
    file: values.file,
  })

  // La rama `migrate` la añade la Tarea 13 (Modify: index.ts), justo aquí,
  // antes del chequeo de "unknown command" de abajo. No la agregues en esta
  // tarea — `./migrate` todavía no existe.

  if (positionals[0] !== undefined) {
    console.error(`✖ unknown command ${JSON.stringify(positionals[0])}\n`)
    console.error(USAGE)
    process.exitCode = 1
    return
  }

  const handle = await startServer({ root, config })
  report(handle.current(), handle.port, config)

  watchMocks({
    root,
    dir: config.dir,
    file: config.file,
    onChange: () => report(handle.reload(), handle.port, config),
  })
}

function report(runtime: Runtime, port: number, config: LaqiConfig): void {
  const count = runtime.table.endpoints.length
  const failed = runtime.errors.length

  console.log(`\n⚡ laqi  http://${config.host}:${port}`)
  const where = runtime.source === 'file' ? `./${config.file}` : `./${config.dir}/`
  console.log(`   watching ${where}  ·  ${count} endpoint${count === 1 ? '' : 's'}`)

  for (const error of runtime.errors) {
    console.error(
      `\n✖ LOAD FAILED  ${error.file}${error.line ? `:${error.line}${error.col ? `:${error.col}` : ''}` : ''}`,
    )
    console.error(`  ${error.message}`)
    if (error.excerpt) console.error(error.excerpt.replace(/^/gm, '  '))
  }

  if (failed > 0) {
    console.error(`\n  ${failed} problem${failed === 1 ? '' : 's'} — the rest of the mock is still served.`)
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
```

- [ ] **Step 7: Probarlo a mano**

```bash
mkdir -p /tmp/laqi-smoke/laqi && cd /tmp/laqi-smoke
cat > laqi/api.json <<'JSON'
{
  "GET /users": {
    "default": "ok",
    "responses": {
      "ok":   { "status": 200, "body": [{ "id": 1, "name": "Ada" }] },
      "boom": { "status": 500, "body": { "code": "INTERNAL" } }
    }
  }
}
JSON
bun <ruta-al-repo>/apps/cli/src/index.ts
```

En otra terminal:

```bash
curl -i localhost:8000/users
curl -i -H 'X-Laqi-Response: boom' localhost:8000/users
curl -i localhost:8000/typo
```

Esperado: 200 con `X-Laqi-Resolved: ok (default)`; 500 con `boom (header)`; 404 con `available: ["GET /users"]`. Editar `laqi/api.json` y volver a hacer curl sin reiniciar nada.

- [ ] **Step 8: Commit**

```bash
git add apps/cli
git commit -m "feat(cli): serve mocks with hot-swap reload that never restarts the server"
```

---

## Task 13: `apps/cli` — `laqi migrate`

Convierte el formato de v1, incluido el hack `(get)files/:id`. Es lo que hace del [ADR-0001](/decisions/0001-rewrite-v2/) una migración y no una ruptura.

**Files:**

- Create: `apps/cli/src/migrate.ts`, `apps/cli/src/migrate.test.ts`
- Modify: `apps/cli/src/index.ts` (la Tarea 12 dejó la rama `migrate` sin conectar a propósito — ver Step 7 de esta tarea)

**Interfaces:**

- Consumes: `HTTP_METHODS`, `isHttpMethod`, `formatEndpointId`, `EndpointDefinition` (Tareas 2–4); `type Runtime`, `startServer`, `report` — el `main()` de `apps/cli/src/index.ts` (Tarea 12)
- Produces: `type MigrationResult = { output: Record<string, EndpointDefinition>; warnings: string[] }`, `migrateV1(input: unknown): MigrationResult`, `runMigrate(options: { root: string; config: LaqiConfig; dryRun: boolean }): boolean`

- [ ] **Step 1: Escribir el test que falla**

```ts
// apps/cli/src/migrate.test.ts
import { describe, expect, it } from 'vitest'
import { migrateV1 } from './migrate'

const simple = {
  post: {
    method: 'GET',
    codeResponse: '200',
    responses: [
      { statusCode: '200', selectorCode: '200', body: { message: 'OK' } },
      { statusCode: '401', selectorCode: 'error401', body: { code: 'error2' } },
    ],
  },
}

describe('migrateV1', () => {
  it('turns a v1 endpoint into a "METHOD /path" key', () => {
    const { output } = migrateV1(simple)
    expect(Object.keys(output)).toEqual(['GET /post'])
  })

  it('turns codeResponse into default', () => {
    expect(migrateV1(simple).output['GET /post']?.default).toBe('200')
  })

  it('turns the responses array into an object keyed by selectorCode', () => {
    const responses = migrateV1(simple).output['GET /post']?.responses ?? {}
    expect(Object.keys(responses).sort()).toEqual(['200', 'error401'])
    expect(responses['error401']?.body).toEqual({ code: 'error2' })
  })

  it('coerces the string statusCode into a number (v1 defect I)', () => {
    expect(migrateV1(simple).output['GET /post']?.responses['200']?.status).toBe(200)
  })

  it('unwraps the (method) prefix hack', () => {
    const input = {
      '(get)files/:id': {
        method: 'GET',
        codeResponse: '200',
        responses: [{ statusCode: '200', selectorCode: '200', body: {} }],
      },
      '(delete)files/:id': {
        method: 'DELETE',
        codeResponse: '200',
        responses: [{ statusCode: '204', selectorCode: '200', body: {} }],
      },
    }
    expect(Object.keys(migrateV1(input).output).sort()).toEqual([
      'DELETE /files/:id',
      'GET /files/:id',
    ])
  })

  it('adds the leading slash a v1 key never had', () => {
    expect(Object.keys(migrateV1(simple).output)[0]).toContain('/post')
  })

  it('warns and skips a null entry instead of throwing (v1 defect B)', () => {
    const { output, warnings } = migrateV1({ ...simple, broken: null })
    expect(Object.keys(output)).toEqual(['GET /post'])
    expect(warnings.join(' ')).toContain('broken')
  })

  it('warns when codeResponse names no selector, and falls back to the first', () => {
    const input = {
      a: {
        method: 'GET',
        codeResponse: 'ghost',
        responses: [{ statusCode: '200', selectorCode: 'ok', body: {} }],
      },
    }
    const { output, warnings } = migrateV1(input)
    expect(output['GET /a']?.default).toBe('ok')
    expect(warnings.join(' ')).toContain('ghost')
  })

  it('disambiguates duplicate selectorCodes within an endpoint', () => {
    const input = {
      a: {
        method: 'GET',
        codeResponse: 'ok',
        responses: [
          { statusCode: '200', selectorCode: 'ok', body: { n: 1 } },
          { statusCode: '201', selectorCode: 'ok', body: { n: 2 } },
        ],
      },
    }
    const { output, warnings } = migrateV1(input)
    expect(Object.keys(output['GET /a']?.responses ?? {})).toEqual(['ok', 'ok-2'])
    expect(warnings.join(' ')).toContain('ok')
  })

  it('warns about a route that would collide after migration (ADR-0008)', () => {
    const input = {
      '(get)files': {
        method: 'GET',
        codeResponse: 'ok',
        responses: [{ statusCode: '200', selectorCode: 'ok', body: {} }],
      },
      files: {
        method: 'GET',
        codeResponse: 'ok',
        responses: [{ statusCode: '200', selectorCode: 'ok', body: {} }],
      },
    }
    expect(migrateV1(input).warnings.join(' ')).toContain('GET /files')
  })

  it('produces output that the v2 schema accepts', async () => {
    const { EndpointSchema, parseEndpointKey } = await import('@laqi/schema')
    const { output } = migrateV1(simple)

    for (const [key, definition] of Object.entries(output)) {
      expect(parseEndpointKey(key).ok).toBe(true)
      expect(EndpointSchema.safeParse(definition).success).toBe(true)
    }
  })

  it('returns nothing for input that is not an object', () => {
    expect(migrateV1('nope').output).toEqual({})
    expect(migrateV1(null).warnings.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `bun run test -- migrate`
Expected: FAIL — `Failed to resolve import "./migrate"`

- [ ] **Step 3: Implementar la conversión**

```ts
// apps/cli/src/migrate.ts
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import {
  formatEndpointId,
  isHttpMethod,
  type EndpointDefinition,
  type LaqiConfig,
  type MockResponse,
} from '@laqi/schema'

export type MigrationResult = {
  output: Record<string, EndpointDefinition>
  warnings: string[]
}

/** El hack de v1 para meter varios métodos bajo la misma clave JSON. */
const METHOD_PREFIX = /^\((\w+)\)(.*)$/

type V1Response = { statusCode?: unknown; selectorCode?: unknown; body?: unknown }
type V1Endpoint = { method?: unknown; codeResponse?: unknown; responses?: unknown }

export function migrateV1(input: unknown): MigrationResult {
  const warnings: string[] = []
  const output: Record<string, EndpointDefinition> = {}

  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { output, warnings: ['input is not a v1 mock object — nothing to migrate'] }
  }

  for (const [key, raw] of Object.entries(input as Record<string, unknown>)) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      warnings.push(`skipped ${JSON.stringify(key)}: not an endpoint object`)
      continue
    }

    const endpoint = raw as V1Endpoint
    const prefixMatch = METHOD_PREFIX.exec(key)
    const rawMethod = prefixMatch ? prefixMatch[1] : endpoint.method
    const rawPath = prefixMatch ? prefixMatch[2] : key
    const method = String(rawMethod ?? 'GET').toUpperCase()

    if (!isHttpMethod(method)) {
      warnings.push(`skipped ${JSON.stringify(key)}: unknown method ${JSON.stringify(rawMethod)}`)
      continue
    }

    const path = String(rawPath ?? '').startsWith('/') ? String(rawPath) : `/${String(rawPath ?? '')}`
    const id = formatEndpointId(method, path)

    if (!Array.isArray(endpoint.responses) || endpoint.responses.length === 0) {
      warnings.push(`skipped ${JSON.stringify(key)}: no responses array`)
      continue
    }

    const responses: Record<string, MockResponse> = {}
    for (const item of endpoint.responses as V1Response[]) {
      const status = Number(item.statusCode ?? 200)
      const base = String(item.selectorCode ?? status)

      let name = base
      let suffix = 2
      while (Object.hasOwn(responses, name)) name = `${base}-${suffix++}`
      if (name !== base) {
        warnings.push(`${id}: duplicate selectorCode ${JSON.stringify(base)} renamed to ${JSON.stringify(name)}`)
      }

      responses[name] = Number.isFinite(status)
        ? { status, ...(item.body === undefined ? {} : { body: item.body }) }
        : { status: 200, ...(item.body === undefined ? {} : { body: item.body }) }
    }

    const names = Object.keys(responses)
    const requested = endpoint.codeResponse === undefined ? undefined : String(endpoint.codeResponse)
    let fallback = names[0] as string

    if (requested !== undefined && names.includes(requested)) {
      fallback = requested
    } else if (requested !== undefined) {
      warnings.push(
        `${id}: codeResponse ${JSON.stringify(requested)} matches no selectorCode — defaulting to ${JSON.stringify(fallback)}`,
      )
    }

    if (Object.hasOwn(output, id)) {
      warnings.push(`${id}: declared more than once — later definition dropped (see ADR-0008)`)
      continue
    }

    output[id] = { default: fallback, responses }
  }

  return { output, warnings }
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `bun run test -- migrate`
Expected: PASS, 12 tests.

- [ ] **Step 5: Añadir el comando que lee y escribe archivos**

Al final de `apps/cli/src/migrate.ts`:

```ts
/** Devuelve true si hubo algún fallo, para que el CLI ponga exit code 1. */
export function runMigrate(options: { root: string; config: LaqiConfig; dryRun: boolean }): boolean {
  const { root, config, dryRun } = options
  const sources = findV1Sources(root, config)

  if (sources.length === 0) {
    console.error('✖ nothing to migrate — no mock-data/ folder or mock.config.json found')
    return true
  }

  let merged: Record<string, EndpointDefinition> = {}
  const warnings: string[] = []

  for (const source of sources) {
    try {
      const result = migrateV1(JSON.parse(readFileSync(source, 'utf8')))
      merged = { ...merged, ...result.output }
      warnings.push(...result.warnings.map((w) => `${relative(root, source)}: ${w}`))
    } catch (error) {
      warnings.push(`${relative(root, source)}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const target = join(root, config.file)
  const contents = `${JSON.stringify(merged, null, 2)}\n`

  if (dryRun) {
    console.log(contents)
  } else if (existsSync(target)) {
    console.error(`✖ ${config.file} already exists — move it aside or run with --dry-run`)
    return true
  } else {
    writeFileSync(target, contents, 'utf8')
    console.log(`✔ wrote ${Object.keys(merged).length} endpoints to ${config.file}`)
  }

  for (const warning of warnings) console.warn(`  ! ${warning}`)

  return false
}

function findV1Sources(root: string, config: LaqiConfig): string[] {
  // v1 leía `path` de mock.config.json, con 'mock-data' por defecto.
  let dir = 'mock-data'
  const legacyConfig = join(root, 'mock.config.json')

  if (existsSync(legacyConfig)) {
    try {
      const parsed = JSON.parse(readFileSync(legacyConfig, 'utf8')) as { path?: unknown }
      if (typeof parsed.path === 'string') dir = parsed.path
    } catch {
      // Config ilegible: seguimos con el default de v1.
    }
  }

  const base = join(root, dir)
  if (!existsSync(base)) return []

  const found: string[] = []
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if (entry.name.startsWith('.')) continue
      const full = join(current, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.json')) found.push(full)
    }
  }
  walk(base)

  return found
}
```

- [ ] **Step 6: Conectar el comando en `index.ts`**

La Tarea 12 dejó `laqi migrate` sin conectar a propósito (`./migrate` todavía no existía). Ahora sí existe: conectarlo.

En `apps/cli/src/index.ts`, añadir el import junto a los demás:

```ts
import { ConfigSchema, type LaqiConfig } from '@laqi/schema'
import { runMigrate } from './migrate'
import type { Runtime } from './runtime'
```

Y reemplazar el comentario que la Tarea 12 dejó como marcador:

```ts
  // La rama `migrate` la añade la Tarea 13 (Modify: index.ts), justo aquí,
  // antes del chequeo de "unknown command" de abajo. No la agregues en esta
  // tarea — `./migrate` todavía no existe.

  if (positionals[0] !== undefined) {
```

por la rama real:

```ts
  if (positionals[0] === 'migrate') {
    const failed = runMigrate({ root, config, dryRun: values['dry-run'] === true })
    if (failed) process.exitCode = 1
    return
  }

  if (positionals[0] !== undefined) {
```

- [ ] **Step 7: Probarlo contra los mocks reales de v1**

```bash
mkdir -p /tmp/laqi-migrate && cd /tmp/laqi-migrate
git -C <ruta-al-repo> show efd99f7:mock-data/multi-endpoint.json > /dev/null 2>&1 \
  && mkdir -p mock-data \
  && git -C <ruta-al-repo> show efd99f7:mock-data/multi-endpoint.json > mock-data/multi-endpoint.json
bun <ruta-al-repo>/apps/cli/src/index.ts migrate --dry-run
```

Esperado: las cinco claves `(get)files/:id`, `(post)files/:id`, etc. salen como `GET /files/:id`, `POST /files/:id`… y `files` como `GET /files`. Sin avisos de colisión.

- [ ] **Step 8: Correr todo el conjunto de tests y verificar tipos**

Run: `bun run test && bun run check-types`
Expected: todo verde — este es el paso que habría fallado si `index.ts` se hubiera dejado sin conectar.

- [ ] **Step 9: Commit**

```bash
git add apps/cli
git commit -m "feat(cli): migrate v1 mock files to the v2 format"
```

---

## Fuera del alcance de este plan

Anotado para que no se pierda:

- **Templating `{{uuid}}` / `{{name}}`** ([ADR-0003](/decisions/0003-declarative-json/)). v1 tenía `(generate:uid)` sin implementar; v2 lo implementa, pero en un plan posterior.
- **v2 no hace eco de `params`, `query` ni `body`** en la respuesta. v1 sí lo hacía, pero como efecto colateral del bug de mutación (defecto A) — no era una feature, era el bug. El reemplazo deliberado es el templating.
- **Control plane, SSE, editor web** → Plan 2. **MCP** → Plan 3. **`--share`** → Plan 4. **Documentación** → Plan 5.
- **Escape hatch en TypeScript** para endpoints con lógica ([ADR-0003](/decisions/0003-declarative-json/)): sin plan asignado todavía.
- **Empaquetado para npm.** El `bin` apunta a `src/index.ts`, que corre con Bun en desarrollo pero no con Node desde un `npx`. El build con tsdown a `dist/` y la verificación de que `npx laqi` funciona en Node limpio van en el Plan 5, junto con la publicación.

## Hallazgos de la revisión de diseño cubiertos acá

| Hallazgo                                  | Dónde se resuelve |
| ----------------------------------------- | ----------------- |
| H2 — colisión entre archivos              | Tarea 7           |
| H3 — carga parcial, no fatal              | Tareas 6 y 12     |
| H5 — errores semánticos con superficie    | Tarea 6           |
| H6 — hot-reload sin reiniciar el servidor | Tarea 12          |
| H7 — `/__laqi` reservado                  | Tarea 3           |
| H10 — nombres `laqi/` y `laqi.json`       | Tarea 4           |

**H1** (404 de `/__laqi` por el túnel), **H4** (header en la caja editable), **H8** (`DELETE` de endpoint), **H9** (curl en modo compartido), **H11** (fuentes) y **H12/H13** (props y cosméticos del prototipo) corresponden a los planes 2 y 4.

## Definición de terminado

- [ ] `bun run test` verde: 13 tareas, ~95 tests
- [ ] `bun run check-types` y `bun run lint` sin errores
- [ ] `laqi` sirve mocks desde `laqi/` y desde `laqi.json`
- [ ] Editar un mock recarga sin reiniciar el proceso
- [ ] Un archivo roto muestra su error y no tumba a los demás
- [ ] `X-Laqi-Resolved` sale en toda respuesta con el formato `<name> (<layer>)`
- [ ] `laqi migrate` convierte los mocks de v1, incluido el hack `(get)`
- [ ] Ninguna request cuelga jamás, en ningún camino
