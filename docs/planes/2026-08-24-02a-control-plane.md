# laqi v2 — Plan 2a: Control plane

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un control plane HTTP + SSE completo bajo `/__laqi/api/*` y `/__laqi/events` — leer y crear/editar/borrar endpoints (escribiendo de vuelta a los archivos de mock), leer y mutar el estado activo, leer escenarios y estado del servidor, y un stream en vivo de requests/recargas/errores. Es la API que el editor web (Plan 2b) y el servidor MCP (Plan 3) van a consumir.

**Architecture:** Dos apps Hono separadas, compuestas en una: `createMockApp()` (Plan 1, sin tocar) sirve los mocks; `createControlPlaneApp()` (nuevo) sirve `/__laqi/api/*` y el SSE, y se monta aparte para que el Plan 4 pueda excluirlo del túnel sin tocar el mock-app. `packages/core` gana un escritor de archivos (`writer.ts`, lee-modifica-escribe JSON preservando el resto del archivo) y un bus de eventos tipado (`events.ts`). `apps/cli/serve.ts` compone ambas apps, conecta el bus, y hace que toda escritura recargue el runtime de inmediato — reusando el hot-swap del Plan 1 sin tocarlo.

**Tech Stack:** El mismo del Plan 1 (Bun, TypeScript, Hono 4.12, Zod 4.3, Vitest). Suma `hono/streaming` (`streamSSE`) para el SSE.

**Spec:** [`docs/diseno/DESIGN.md`](../diseno/DESIGN.md) sección 7 (contratos de API, con la corrección de `DELETE` del hallazgo H8), [`docs/diseno/STATE-MODEL.md`](../diseno/STATE-MODEL.md), [`docs/diseno/revision-vs-decisiones.md`](../diseno/revision-vs-decisiones.md) (H1, H4, H5, H7, H8, H9), [`docs/decisiones/0006-servidor-mcp.md`](../decisiones/0006-servidor-mcp.md), [`docs/decisiones/0007-url-publica.md`](../decisiones/0007-url-publica.md).

## Global Constraints

- **TDD obligatorio.** Ningún código de producción sin un test que falle primero.
- **TypeScript estricto**, ESM. Nada de CommonJS.
- El control plane vive en un **Hono app separado** del mock-app (`createControlPlaneApp()` ≠ `createMockApp()`), montados juntos sólo en `apps/cli`. Nunca fusionar sus rutas en un solo archivo — es la separación que el Plan 4 necesita para poder excluir `/__laqi` del túnel sin tocar el código de mocks.
- **Este plan NO implementa el bloqueo del túnel.** Eso es responsabilidad del Plan 4 (que decide cómo evitar que `/__laqi/*` salga por la URL pública). Este plan sólo entrega la separación estructural que lo hace posible.
- `/__laqi` sigue siendo prefijo reservado (Plan 1, `RESERVED_PREFIX` en `@laqi/schema`) — ningún mock puede ocuparlo. Ya está enforced end-to-end; este plan no lo toca.
- **Toda escritura al disco valida contra el esquema Zod correspondiente antes de escribir.** Nunca se persiste una definición de endpoint inválida.
- **Toda escritura recarga el runtime de inmediato**, en el mismo request que la originó — nunca depender sólo del watcher de archivos (que además la recoge, de forma redundante e inofensiva, unos milisegundos después).
- El bus de eventos es un tipo cerrado: `request | endpoints-changed | error`. No agregar `share-changed` — eso pertenece al Plan 4, que aún no existe.
- Commits con Conventional Commits.

## Nota de verificación previa

Antes de escribir este plan se verificó, ejecutando código real:

- `streamSSE` de `hono/streaming` funciona correctamente sobre `@hono/node-server`: content-type correcto, eventos entregados en orden, y **el cleanup del listener al desconectar el cliente (`onAbort`) sí dispara bajo Node real** — bajo Bun puro NO dispara (fuga de listener), pero **los tests de este repo (`bun run test` → vitest) corren en un proceso Node real** (`process.versions.node` presente, `typeof Bun === 'undefined'` dentro del test), así que el test de cleanup del SSE es válido tal como está escrito abajo.
- Componer dos apps Hono con `top.route('/__laqi', controlPlaneApp); top.route('/', mockApp)` funciona: las rutas de cada una responden correctamente, y un typo bajo `/__laqi/*` que ninguna de las dos rutas reconoce cae en el catch-all del mock-app (no es un hueco de seguridad, porque `/__laqi/*` ya está prohibido para cualquier mock — pero el control-plane-app se lleva su propio catch-all de todos modos, para un mensaje de error más claro).
- Un id compuesto como `"GET /users/:id/orders/:orderId"` viaja correctamente como un único path param `:id` si se codifica con `encodeURIComponent` en el cliente y se decodifica con `decodeURIComponent` en el servidor — verificado el round-trip exacto.

---

## Estructura de archivos

```
packages/core/src/
├── events.ts                 NUEVO — LaqiEvent, EventBus
├── events.test.ts
├── writer.ts                 NUEVO — updateEndpointInFile, createEndpointInFile, deleteEndpointFromFile
├── writer.test.ts
└── index.ts                  MODIFICAR — exportar events y writer

packages/server/src/
├── control-plane-app.ts      NUEVO — createControlPlaneApp(runtime): Hono
├── control-plane-app.test.ts
├── mock-app.ts                MODIFICAR — MockRuntime gana onRequest opcional
├── mock-app.test.ts           MODIFICAR — test de que onRequest se dispara
└── index.ts                   MODIFICAR — exportar control-plane-app

apps/cli/src/
├── serve.ts            MODIFICAR — compone control-plane + mock app, conecta el bus, escrituras con reload inmediato
└── serve.test.ts       MODIFICAR — tests de integración: crear/editar/borrar vía HTTP, SSE end-to-end
```

---

## Task 1: `packages/core` — bus de eventos

**Files:**
- Create: `packages/core/src/events.ts`, `packages/core/src/events.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `LoadError` (Plan 1, ya en `@laqi/core`)
- Produces: `type LaqiEvent = { type: 'request'; method: string; path: string; status: number; resolvedName: string; resolvedLayer: string; ms: number } | { type: 'endpoints-changed'; endpointCount: number } | { type: 'error'; file: string; line?: number; col?: number; message: string; excerpt?: string }`, `class EventBus { emit(event: LaqiEvent): void; subscribe(listener: (event: LaqiEvent) => void): () => void }`

- [ ] **Step 1: Escribir el test que falla**

```ts
// packages/core/src/events.test.ts
import { describe, expect, it, vi } from 'vitest'
import { EventBus, type LaqiEvent } from './events'

describe('EventBus', () => {
  it('delivers an emitted event to a subscribed listener', () => {
    const bus = new EventBus()
    const listener = vi.fn()
    bus.subscribe(listener)

    const event: LaqiEvent = { type: 'endpoints-changed', endpointCount: 3 }
    bus.emit(event)

    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith(event)
  })

  it('delivers to every subscriber', () => {
    const bus = new EventBus()
    const a = vi.fn()
    const b = vi.fn()
    bus.subscribe(a)
    bus.subscribe(b)

    bus.emit({ type: 'endpoints-changed', endpointCount: 1 })

    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)
  })

  it('stops delivering after unsubscribe', () => {
    const bus = new EventBus()
    const listener = vi.fn()
    const unsubscribe = bus.subscribe(listener)

    unsubscribe()
    bus.emit({ type: 'endpoints-changed', endpointCount: 1 })

    expect(listener).not.toHaveBeenCalled()
  })

  it('unsubscribing one listener does not affect another', () => {
    const bus = new EventBus()
    const a = vi.fn()
    const b = vi.fn()
    const unsubscribeA = bus.subscribe(a)
    bus.subscribe(b)

    unsubscribeA()
    bus.emit({ type: 'endpoints-changed', endpointCount: 1 })

    expect(a).not.toHaveBeenCalled()
    expect(b).toHaveBeenCalledTimes(1)
  })

  it('carries a request event with the exact fields the log needs', () => {
    const bus = new EventBus()
    const listener = vi.fn()
    bus.subscribe(listener)

    const event: LaqiEvent = {
      type: 'request',
      method: 'GET',
      path: '/users',
      status: 200,
      resolvedName: 'ok',
      resolvedLayer: 'default',
      ms: 4,
    }
    bus.emit(event)

    expect(listener).toHaveBeenCalledWith(event)
  })

  it('carries an error event with file position', () => {
    const bus = new EventBus()
    const listener = vi.fn()
    bus.subscribe(listener)

    const event: LaqiEvent = {
      type: 'error',
      file: 'laqi/api.json',
      line: 4,
      col: 7,
      message: 'trailing comma',
      excerpt: '4 | }\n  | ^',
    }
    bus.emit(event)

    expect(listener).toHaveBeenCalledWith(event)
  })

  it('a listener throwing does not stop delivery to the next listener', () => {
    const bus = new EventBus()
    const broken = vi.fn(() => {
      throw new Error('boom')
    })
    const healthy = vi.fn()
    bus.subscribe(broken)
    bus.subscribe(healthy)

    expect(() => bus.emit({ type: 'endpoints-changed', endpointCount: 1 })).not.toThrow()
    expect(healthy).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `bun run test -- events`
Expected: FAIL — `Failed to resolve import "./events"`

- [ ] **Step 3: Implementar**

```ts
// packages/core/src/events.ts

export type LaqiEvent =
  | {
      type: 'request'
      method: string
      path: string
      status: number
      resolvedName: string
      resolvedLayer: string
      ms: number
    }
  | { type: 'endpoints-changed'; endpointCount: number }
  | { type: 'error'; file: string; line?: number; col?: number; message: string; excerpt?: string }

/**
 * Un bus en memoria, un solo proceso. No hay cola ni persistencia: un
 * suscriptor que no está conectado cuando algo pasa, se lo pierde — eso está
 * bien, es exactamente lo que el flujo F3 (mirar requests en vivo) espera.
 */
export class EventBus {
  private listeners = new Set<(event: LaqiEvent) => void>()

  emit(event: LaqiEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch {
        // Un suscriptor roto no debe tumbar a los demás ni al emisor.
      }
    }
  }

  subscribe(listener: (event: LaqiEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `bun run test -- events`
Expected: PASS, 7 tests.

- [ ] **Step 5: Exportar desde el índice**

```ts
// packages/core/src/index.ts
export * from './json-position'
export * from './loader'
export * from './route-table'
export * from './state-store'
export * from './resolve'
export * from './events'
```

- [ ] **Step 6: Commit**

```bash
git add packages/core
git commit -m "feat(core): add typed in-memory event bus for the control plane"
```

---

## Task 2: `packages/core` — escritor de archivos: actualizar y borrar

**Files:**
- Create: `packages/core/src/writer.ts`, `packages/core/src/writer.test.ts`

**Interfaces:**
- Consumes: `EndpointSchema`, `type EndpointDefinition` (Plan 1, `@laqi/schema`)
- Produces: `type WriteResult = { ok: true } | { ok: false; error: string }`, `updateEndpointInFile(params: { root: string; file: string; id: string; definition: EndpointDefinition }): WriteResult`, `deleteEndpointFromFile(params: { root: string; file: string; id: string }): WriteResult`

- [ ] **Step 1: Escribir el test que falla**

```ts
// packages/core/src/writer.test.ts
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { deleteEndpointFromFile, updateEndpointInFile } from './writer'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'laqi-writer-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function writeMock(relative: string, contents: unknown) {
  const full = join(root, relative)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, JSON.stringify(contents, null, 2), 'utf8')
}

function readMock(relative: string): unknown {
  return JSON.parse(readFileSync(join(root, relative), 'utf8'))
}

const okDefinition = { default: 'ok', responses: { ok: { status: 200, body: [] } } }

describe('updateEndpointInFile', () => {
  it('replaces the value at the existing key, in place', () => {
    writeMock('laqi/api.json', {
      'GET /users': { default: 'ok', responses: { ok: { status: 200, body: [] } } },
      'GET /orders': { default: 'ok', responses: { ok: { status: 200, body: [] } } },
    })

    const updated = {
      default: 'empty',
      responses: { ok: { status: 200, body: [] }, empty: { status: 200, body: [] } },
    }
    const result = updateEndpointInFile({ root, file: 'laqi/api.json', id: 'GET /users', definition: updated })

    expect(result.ok).toBe(true)
    const contents = readMock('laqi/api.json') as Record<string, unknown>
    expect(contents['GET /users']).toEqual(updated)
    expect(contents['GET /orders']).toEqual({ default: 'ok', responses: { ok: { status: 200, body: [] } } })
  })

  it('preserves sibling key order', () => {
    writeMock('laqi/api.json', { a: okDefinition, b: okDefinition, c: okDefinition })
    updateEndpointInFile({ root, file: 'laqi/api.json', id: 'b', definition: { default: 'ok', responses: { ok: { status: 201, body: {} } } } })
    expect(Object.keys(readMock('laqi/api.json') as object)).toEqual(['a', 'b', 'c'])
  })

  it('rejects an invalid definition without writing anything', () => {
    writeMock('laqi/api.json', { 'GET /users': okDefinition })
    const before = readFileSync(join(root, 'laqi/api.json'), 'utf8')

    const result = updateEndpointInFile({
      root,
      file: 'laqi/api.json',
      id: 'GET /users',
      definition: { default: 'nope', responses: { ok: { status: 200 } } } as never,
    })

    expect(result.ok).toBe(false)
    expect(readFileSync(join(root, 'laqi/api.json'), 'utf8')).toBe(before)
  })

  it('fails cleanly when the id does not exist in the file', () => {
    writeMock('laqi/api.json', { 'GET /users': okDefinition })
    const result = updateEndpointInFile({ root, file: 'laqi/api.json', id: 'GET /ghost', definition: okDefinition })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('GET /ghost')
  })

  it('fails cleanly when the file does not exist', () => {
    const result = updateEndpointInFile({ root, file: 'laqi/nope.json', id: 'GET /users', definition: okDefinition })
    expect(result.ok).toBe(false)
  })
})

describe('deleteEndpointFromFile', () => {
  it('removes the key and leaves siblings untouched', () => {
    writeMock('laqi/api.json', { 'GET /users': okDefinition, 'GET /orders': okDefinition })
    const result = deleteEndpointFromFile({ root, file: 'laqi/api.json', id: 'GET /users' })

    expect(result.ok).toBe(true)
    const contents = readMock('laqi/api.json') as Record<string, unknown>
    expect('GET /users' in contents).toBe(false)
    expect(contents['GET /orders']).toEqual(okDefinition)
  })

  it('fails cleanly when the id does not exist', () => {
    writeMock('laqi/api.json', { 'GET /users': okDefinition })
    const result = deleteEndpointFromFile({ root, file: 'laqi/api.json', id: 'GET /ghost' })
    expect(result.ok).toBe(false)
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `bun run test -- writer`
Expected: FAIL — `Failed to resolve import "./writer"`

- [ ] **Step 3: Implementar**

```ts
// packages/core/src/writer.ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { EndpointSchema, type EndpointDefinition } from '@laqi/schema'

export type WriteResult = { ok: true } | { ok: false; error: string }

function readFileObject(fullPath: string): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  if (!existsSync(fullPath)) return { ok: false, error: `file not found: ${fullPath}` }

  try {
    const parsed: unknown = JSON.parse(readFileSync(fullPath, 'utf8'))
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { ok: false, error: `not a JSON object: ${fullPath}` }
    }
    return { ok: true, value: parsed as Record<string, unknown> }
  } catch (error) {
    return { ok: false, error: `invalid JSON: ${error instanceof Error ? error.message : String(error)}` }
  }
}

function writeFileObject(fullPath: string, contents: Record<string, unknown>): void {
  writeFileSync(fullPath, `${JSON.stringify(contents, null, 2)}\n`, 'utf8')
}

export function updateEndpointInFile(params: {
  root: string
  file: string
  id: string
  definition: EndpointDefinition
}): WriteResult {
  const { root, file, id, definition } = params
  const fullPath = join(root, file)

  const validated = EndpointSchema.safeParse(definition)
  if (!validated.success) {
    return { ok: false, error: validated.error.issues.map((i) => i.message).join('; ') }
  }

  const read = readFileObject(fullPath)
  if (!read.ok) return read

  if (!Object.hasOwn(read.value, id)) {
    return { ok: false, error: `no endpoint ${JSON.stringify(id)} in ${file}` }
  }

  read.value[id] = validated.data
  writeFileObject(fullPath, read.value)
  return { ok: true }
}

export function createEndpointInFile(params: {
  root: string
  file: string
  id: string
  definition: EndpointDefinition
}): WriteResult {
  const { root, file, id, definition } = params
  const fullPath = join(root, file)

  const validated = EndpointSchema.safeParse(definition)
  if (!validated.success) {
    return { ok: false, error: validated.error.issues.map((i) => i.message).join('; ') }
  }

  // El archivo puede no existir todavía (primer endpoint creado desde el panel).
  const read = existsSync(fullPath) ? readFileObject(fullPath) : { ok: true as const, value: {} }
  if (!read.ok) return read

  if (Object.hasOwn(read.value, id)) {
    return { ok: false, error: `${JSON.stringify(id)} already exists in ${file}` }
  }

  read.value[id] = validated.data
  writeFileObject(fullPath, read.value)
  return { ok: true }
}

export function deleteEndpointFromFile(params: { root: string; file: string; id: string }): WriteResult {
  const { root, file, id } = params
  const fullPath = join(root, file)

  const read = readFileObject(fullPath)
  if (!read.ok) return read

  if (!Object.hasOwn(read.value, id)) {
    return { ok: false, error: `no endpoint ${JSON.stringify(id)} in ${file}` }
  }

  delete read.value[id]
  writeFileObject(fullPath, read.value)
  return { ok: true }
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `bun run test -- writer`
Expected: PASS, 7 tests (los de `updateEndpointInFile` y `deleteEndpointFromFile`; `createEndpointInFile` se testea en la Tarea 3, aunque su implementación ya queda escrita acá porque comparte el mismo archivo y las mismas funciones internas).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/writer.ts packages/core/src/writer.test.ts
git commit -m "feat(core): write endpoint updates and deletions back to mock files"
```

---

## Task 3: `packages/core` — escritor de archivos: crear

**Files:**
- Modify: `packages/core/src/writer.test.ts`, `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `createEndpointInFile` (ya implementada en la Tarea 2, sin tests todavía)
- Produces: sin símbolos nuevos — esta tarea sólo agrega cobertura y la exportación

- [ ] **Step 1: Escribir el test que falla**

Añadir al final de `packages/core/src/writer.test.ts` (después del bloque `describe('deleteEndpointFromFile', ...)`):

```ts
describe('createEndpointInFile', () => {
  it('creates the file if it does not exist yet, with the one endpoint', () => {
    const result = createEndpointInFile({ root, file: 'laqi/api.json', id: 'GET /users', definition: okDefinition })

    expect(result.ok).toBe(true)
    expect(readMock('laqi/api.json')).toEqual({ 'GET /users': okDefinition })
  })

  it('appends to an existing file without touching its other keys', () => {
    writeMock('laqi/api.json', { 'GET /users': okDefinition })
    const result = createEndpointInFile({
      root,
      file: 'laqi/api.json',
      id: 'GET /orders',
      definition: { default: 'ok', responses: { ok: { status: 200, body: [] } } },
    })

    expect(result.ok).toBe(true)
    const contents = readMock('laqi/api.json') as Record<string, unknown>
    expect(contents['GET /users']).toEqual(okDefinition)
    expect(contents['GET /orders']).toBeDefined()
  })

  it('refuses to overwrite an id that already exists', () => {
    writeMock('laqi/api.json', { 'GET /users': okDefinition })
    const result = createEndpointInFile({ root, file: 'laqi/api.json', id: 'GET /users', definition: okDefinition })
    expect(result.ok).toBe(false)
  })

  it('rejects an invalid definition without creating the file', () => {
    const result = createEndpointInFile({
      root,
      file: 'laqi/api.json',
      id: 'GET /users',
      definition: { default: 'ghost', responses: { ok: { status: 200 } } } as never,
    })
    expect(result.ok).toBe(false)
    expect(existsSync(join(root, 'laqi/api.json'))).toBe(false)
  })
})
```

Y añadir `existsSync` al import de `node:fs` al inicio del archivo de test:

```ts
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `bun run test -- writer`
Expected: FAIL — `existsSync` no importado todavía en el test causa un error de referencia antes de siquiera correr, o (si ya se agregó el import) los 4 tests nuevos de `createEndpointInFile` pasan de una porque la implementación de la Tarea 2 ya la incluye. **Si los 4 tests nuevos pasan de inmediato, eso es correcto** — la implementación se escribió completa en la Tarea 2 porque las tres funciones comparten el mismo archivo; esta tarea es la que la pone bajo test explícito. Confirmar igual con el comando de abajo.

- [ ] **Step 3: Confirmar y exportar desde el índice**

`packages/core/src/writer.ts` no cambia. Sólo falta exportarlo:

```ts
// packages/core/src/index.ts
export * from './json-position'
export * from './loader'
export * from './route-table'
export * from './state-store'
export * from './resolve'
export * from './events'
export * from './writer'
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `bun run test -- writer`
Expected: PASS, 11 tests en total (7 de la Tarea 2 + 4 nuevos).

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "test(core): cover createEndpointInFile, export writer from @laqi/core"
```


## Task 4: `packages/server` — control plane: leer endpoints, leer/mutar estado

Arranca el archivo `control-plane-app.ts`. Establece la forma completa de la app (con su propio catch-all al final) para que las tareas 5–8 sólo inserten rutas nuevas antes de ese catch-all, con un punto de inserción exacto — el mismo patrón que ya funcionó en el Plan 1 para `mock-app.ts`.

**Files:**
- Create: `packages/server/src/control-plane-app.ts`, `packages/server/src/control-plane-app.test.ts`

**Interfaces:**
- Consumes: `type LoadedEndpoint` (`@laqi/core`); `StateSchema`, `type LaqiState` (`@laqi/schema`)
- Produces: `type ControlPlaneRuntime = { getEndpoints: () => LoadedEndpoint[]; getState: () => LaqiState; setState: (state: LaqiState) => void; ... }` (el tipo se completa en tareas posteriores, pero el nombre y estos dos primeros campos quedan fijos desde acá), `createControlPlaneApp(runtime: ControlPlaneRuntime): Hono`

- [ ] **Step 1: Escribir el test que falla**

```ts
// packages/server/src/control-plane-app.test.ts
import type { LoadedEndpoint } from '@laqi/core'
import type { LaqiState } from '@laqi/schema'
import { describe, expect, it, vi } from 'vitest'
import { createControlPlaneApp, type ControlPlaneRuntime } from './control-plane-app'

const usersEndpoint: LoadedEndpoint = {
  id: 'GET /users',
  method: 'GET',
  path: '/users',
  default: 'ok',
  responses: { ok: { status: 200, body: [] }, boom: { status: 500, body: {} } },
  file: 'laqi/api.json',
  line: 2,
}

function makeRuntime(overrides: Partial<ControlPlaneRuntime> = {}): ControlPlaneRuntime {
  let state: LaqiState = { scenario: null, overrides: {} }
  return {
    getEndpoints: () => [usersEndpoint],
    getState: () => state,
    setState: (next) => {
      state = next
    },
    ...overrides,
  }
}

describe('GET /api/endpoints', () => {
  it('lists the loaded endpoints', async () => {
    const app = createControlPlaneApp(makeRuntime())
    const res = await app.request('/api/endpoints')
    expect(res.status).toBe(200)
    const body = (await res.json()) as LoadedEndpoint[]
    expect(body).toEqual([usersEndpoint])
  })
})

describe('GET /api/state', () => {
  it('returns the current state', async () => {
    const app = createControlPlaneApp(makeRuntime({ getState: () => ({ scenario: 'checkout-broken', overrides: { 'GET /users': 'boom' } }) }))
    const res = await app.request('/api/state')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ scenario: 'checkout-broken', overrides: { 'GET /users': 'boom' } })
  })
})

describe('PUT /api/state', () => {
  it('persists a valid state and echoes it back', async () => {
    const setState = vi.fn()
    const app = createControlPlaneApp(makeRuntime({ setState }))

    const res = await app.request('/api/state', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scenario: null, overrides: { 'GET /users': 'boom' } }),
    })

    expect(res.status).toBe(200)
    expect(setState).toHaveBeenCalledWith({ scenario: null, overrides: { 'GET /users': 'boom' } })
    expect(await res.json()).toEqual({ scenario: null, overrides: { 'GET /users': 'boom' } })
  })

  it('fills in defaults for a partial body', async () => {
    const setState = vi.fn()
    const app = createControlPlaneApp(makeRuntime({ setState }))

    const res = await app.request('/api/state', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })

    expect(res.status).toBe(200)
    expect(setState).toHaveBeenCalledWith({ scenario: null, overrides: {} })
  })

  it('rejects a malformed body with 400 and does not call setState', async () => {
    const setState = vi.fn()
    const app = createControlPlaneApp(makeRuntime({ setState }))

    const res = await app.request('/api/state', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ overrides: 42 }),
    })

    expect(res.status).toBe(400)
    expect(setState).not.toHaveBeenCalled()
  })

  it('rejects a body that is not valid JSON at all', async () => {
    const app = createControlPlaneApp(makeRuntime())
    const res = await app.request('/api/state', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    })
    expect(res.status).toBe(400)
  })
})

describe('unmatched /__laqi paths', () => {
  it('returns a control-plane-flavoured 404, not a bare Hono 404', async () => {
    const app = createControlPlaneApp(makeRuntime())
    const res = await app.request('/api/nope')
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('laqi-control-plane')
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `bun run test -- control-plane-app`
Expected: FAIL — `Failed to resolve import "./control-plane-app"`

- [ ] **Step 3: Implementar**

```ts
// packages/server/src/control-plane-app.ts
import type { LoadedEndpoint } from '@laqi/core'
import { StateSchema, type LaqiState } from '@laqi/schema'
import { Hono } from 'hono'

/**
 * Todo lo que el control plane necesita del proceso que lo hospeda. Cada
 * tarea de este plan agrega los campos que sus rutas necesitan — este tipo
 * es el contrato completo recién al final de la Tarea 8.
 */
export type ControlPlaneRuntime = {
  getEndpoints: () => LoadedEndpoint[]
  getState: () => LaqiState
  setState: (state: LaqiState) => void
}

export function createControlPlaneApp(runtime: ControlPlaneRuntime): Hono {
  const app = new Hono()

  app.get('/api/endpoints', (c) => c.json(runtime.getEndpoints()))

  app.get('/api/state', (c) => c.json(runtime.getState()))

  app.put('/api/state', async (c) => {
    let raw: unknown
    try {
      raw = await c.req.json()
    } catch {
      return c.json({ error: 'laqi-control-plane', message: 'body is not valid JSON' }, 400)
    }

    const parsed = StateSchema.safeParse(raw)
    if (!parsed.success) {
      return c.json(
        { error: 'laqi-control-plane', message: parsed.error.issues.map((i) => i.message).join('; ') },
        400,
      )
    }

    runtime.setState(parsed.data)
    return c.json(parsed.data)
  })

  // Punto de inserción para las tareas 5–8: las rutas nuevas van ACÁ,
  // antes de este catch-all — nunca después.
  app.all('*', (c) =>
    c.json({ error: 'laqi-control-plane', message: 'no matching route', path: c.req.path }, 404),
  )

  return app
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `bun run test -- control-plane-app`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/control-plane-app.ts packages/server/src/control-plane-app.test.ts
git commit -m "feat(server): control plane — read endpoints, read/write state"
```

---

## Task 5: `packages/server` — control plane: escenarios y estado del servidor

**Files:**
- Modify: `packages/server/src/control-plane-app.ts`, `packages/server/src/control-plane-app.test.ts`

**Interfaces:**
- Consumes: `type Scenarios` (`@laqi/schema`); `type LoadError` (`@laqi/core`)
- Produces: `ControlPlaneRuntime` gana `getScenarios: () => Scenarios` y `getStatus: () => { watching: string; endpointCount: number; address: string; errors: LoadError[] }`

- [ ] **Step 1: Escribir el test que falla**

Añadir a `packages/server/src/control-plane-app.test.ts`, después del `describe('unmatched /__laqi paths', ...)`:

```ts
describe('GET /api/scenarios', () => {
  it('returns the loaded scenarios', async () => {
    const app = createControlPlaneApp(
      makeRuntime({ getScenarios: () => ({ 'checkout-broken': { 'GET /users': 'boom' } }) }),
    )
    const res = await app.request('/api/scenarios')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ 'checkout-broken': { 'GET /users': 'boom' } })
  })
})

describe('GET /api/status', () => {
  it('returns what the CLI is watching, and load errors', async () => {
    const app = createControlPlaneApp(
      makeRuntime({
        getStatus: () => ({
          watching: 'laqi/',
          endpointCount: 27,
          address: '127.0.0.1:8000',
          errors: [{ file: 'laqi/orders.json', line: 14, col: 7, message: 'trailing comma', excerpt: '...' }],
        }),
      }),
    )
    const res = await app.request('/api/status')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      watching: 'laqi/',
      endpointCount: 27,
      address: '127.0.0.1:8000',
      errors: [{ file: 'laqi/orders.json', line: 14, col: 7, message: 'trailing comma', excerpt: '...' }],
    })
  })
})
```

And add `getScenarios`/`getStatus` to the `makeRuntime` helper's default so every other test in the file keeps working:

```ts
function makeRuntime(overrides: Partial<ControlPlaneRuntime> = {}): ControlPlaneRuntime {
  let state: LaqiState = { scenario: null, overrides: {} }
  return {
    getEndpoints: () => [usersEndpoint],
    getState: () => state,
    setState: (next) => {
      state = next
    },
    getScenarios: () => ({}),
    getStatus: () => ({ watching: 'laqi/', endpointCount: 1, address: '127.0.0.1:8000', errors: [] }),
    ...overrides,
  }
}
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `bun run test -- control-plane-app`
Expected: FAIL — `TypeError: runtime.getScenarios is not a function` (o similar), porque `createControlPlaneApp` todavía no expone esas rutas.

- [ ] **Step 3: Implementar**

En `packages/server/src/control-plane-app.ts`, agregar los dos campos al tipo:

```ts
export type ControlPlaneRuntime = {
  getEndpoints: () => LoadedEndpoint[]
  getState: () => LaqiState
  setState: (state: LaqiState) => void
  getScenarios: () => Scenarios
  getStatus: () => { watching: string; endpointCount: number; address: string; errors: LoadError[] }
}
```

Reemplazar las dos líneas de import del inicio del archivo (las que escribió la Tarea 4):

```ts
import type { LoadedEndpoint } from '@laqi/core'
import { StateSchema, type LaqiState } from '@laqi/schema'
```

por:

```ts
import type { LoadedEndpoint, LoadError } from '@laqi/core'
import { StateSchema, type LaqiState, type Scenarios } from '@laqi/schema'
```

(La tercera línea, `import { Hono } from 'hono'`, no cambia — dejarla como está.)

Reemplazar:

```ts
  // Punto de inserción para las tareas 5–8: las rutas nuevas van ACÁ,
  // antes de este catch-all — nunca después.
  app.all('*', (c) =>
```

por:

```ts
  app.get('/api/scenarios', (c) => c.json(runtime.getScenarios()))

  app.get('/api/status', (c) => c.json(runtime.getStatus()))

  // Punto de inserción para las tareas 6–8: las rutas nuevas van ACÁ,
  // antes de este catch-all — nunca después.
  app.all('*', (c) =>
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `bun run test -- control-plane-app`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/control-plane-app.ts packages/server/src/control-plane-app.test.ts
git commit -m "feat(server): control plane — read scenarios and server status"
```


## Task 6: `packages/server` — control plane: crear endpoint

**Files:**
- Modify: `packages/server/src/control-plane-app.ts`, `packages/server/src/control-plane-app.test.ts`

**Interfaces:**
- Consumes: `isHttpMethod`, `formatEndpointId`, `type HttpMethod`, `EndpointSchema` (`@laqi/schema`, Plan 1)
- Produces: `ControlPlaneRuntime` gana `createEndpoint: (input: { method: HttpMethod; path: string; description?: string; default: string; responses: Record<string, unknown> }) => { ok: true; id: string } | { ok: false; error: string }`

- [ ] **Step 1: Escribir el test que falla**

Añadir a `packages/server/src/control-plane-app.test.ts`:

```ts
describe('POST /api/endpoints', () => {
  it('creates the endpoint and returns 201 with its id', async () => {
    const createEndpoint = vi.fn(() => ({ ok: true as const, id: 'POST /orders' }))
    const app = createControlPlaneApp(makeRuntime({ createEndpoint }))

    const res = await app.request('/api/endpoints', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        method: 'POST',
        path: '/orders',
        default: 'created',
        responses: { created: { status: 201, body: {} } },
      }),
    })

    expect(res.status).toBe(201)
    expect(createEndpoint).toHaveBeenCalledWith({
      method: 'POST',
      path: '/orders',
      description: undefined,
      default: 'created',
      responses: { created: { status: 201, body: {} } },
    })
    expect(await res.json()).toEqual({ id: 'POST /orders' })
  })

  it('rejects an unknown HTTP method', async () => {
    const createEndpoint = vi.fn()
    const app = createControlPlaneApp(makeRuntime({ createEndpoint }))

    const res = await app.request('/api/endpoints', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: 'FETCH', path: '/orders', default: 'ok', responses: { ok: { status: 200 } } }),
    })

    expect(res.status).toBe(400)
    expect(createEndpoint).not.toHaveBeenCalled()
  })

  it('rejects a path that does not start with "/"', async () => {
    const createEndpoint = vi.fn()
    const app = createControlPlaneApp(makeRuntime({ createEndpoint }))

    const res = await app.request('/api/endpoints', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: 'GET', path: 'orders', default: 'ok', responses: { ok: { status: 200 } } }),
    })

    expect(res.status).toBe(400)
    expect(createEndpoint).not.toHaveBeenCalled()
  })

  it('rejects an invalid endpoint definition (no responses)', async () => {
    const createEndpoint = vi.fn()
    const app = createControlPlaneApp(makeRuntime({ createEndpoint }))

    const res = await app.request('/api/endpoints', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: 'GET', path: '/orders', default: 'ok', responses: {} }),
    })

    expect(res.status).toBe(400)
    expect(createEndpoint).not.toHaveBeenCalled()
  })

  it('propagates a failure from the runtime (e.g. duplicate id) as a client error', async () => {
    const createEndpoint = vi.fn(() => ({ ok: false as const, error: '"GET /orders" already exists' }))
    const app = createControlPlaneApp(makeRuntime({ createEndpoint }))

    const res = await app.request('/api/endpoints', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: 'GET', path: '/orders', default: 'ok', responses: { ok: { status: 200 } } }),
    })

    expect(res.status).toBe(409)
    const body = (await res.json()) as { message: string }
    expect(body.message).toContain('already exists')
  })
})
```

Y agregar `createEndpoint` al `makeRuntime` default:

```ts
    getScenarios: () => ({}),
    getStatus: () => ({ watching: 'laqi/', endpointCount: 1, address: '127.0.0.1:8000', errors: [] }),
    createEndpoint: () => ({ ok: true, id: 'GET /new' }),
    ...overrides,
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `bun run test -- control-plane-app`
Expected: FAIL — `POST /api/endpoints` no existe todavía, cae en el catch-all (404, no 201/400/409).

- [ ] **Step 3: Implementar**

En `packages/server/src/control-plane-app.ts`, agregar al tipo:

```ts
export type ControlPlaneRuntime = {
  getEndpoints: () => LoadedEndpoint[]
  getState: () => LaqiState
  setState: (state: LaqiState) => void
  getScenarios: () => Scenarios
  getStatus: () => { watching: string; endpointCount: number; address: string; errors: LoadError[] }
  createEndpoint: (input: {
    method: HttpMethod
    path: string
    description?: string
    default: string
    responses: Record<string, unknown>
  }) => { ok: true; id: string } | { ok: false; error: string }
}
```

Reemplazar las dos líneas de import del inicio del archivo (tal como quedaron tras la Tarea 5):

```ts
import type { LoadedEndpoint, LoadError } from '@laqi/core'
import { StateSchema, type LaqiState, type Scenarios } from '@laqi/schema'
```

por:

```ts
import type { LoadedEndpoint, LoadError } from '@laqi/core'
import { EndpointSchema, isHttpMethod, StateSchema, type HttpMethod, type LaqiState, type Scenarios } from '@laqi/schema'
```

(La línea de `Hono` no cambia.)

Reemplazar el marcador de inserción:

```ts
  // Punto de inserción para las tareas 6–8: las rutas nuevas van ACÁ,
  // antes de este catch-all — nunca después.
  app.all('*', (c) =>
```

por:

```ts
  app.post('/api/endpoints', async (c) => {
    let raw: unknown
    try {
      raw = await c.req.json()
    } catch {
      return c.json({ error: 'laqi-control-plane', message: 'body is not valid JSON' }, 400)
    }

    if (typeof raw !== 'object' || raw === null) {
      return c.json({ error: 'laqi-control-plane', message: 'body must be an object' }, 400)
    }
    const input = raw as Record<string, unknown>

    if (typeof input.method !== 'string' || !isHttpMethod(input.method.toUpperCase())) {
      return c.json({ error: 'laqi-control-plane', message: `unknown method ${JSON.stringify(input.method)}` }, 400)
    }
    if (typeof input.path !== 'string' || !input.path.startsWith('/')) {
      return c.json({ error: 'laqi-control-plane', message: 'path must start with "/"' }, 400)
    }

    const definition = EndpointSchema.safeParse({
      description: input.description,
      default: input.default,
      responses: input.responses,
    })
    if (!definition.success) {
      return c.json(
        { error: 'laqi-control-plane', message: definition.error.issues.map((i) => i.message).join('; ') },
        400,
      )
    }

    const result = runtime.createEndpoint({
      method: input.method.toUpperCase() as HttpMethod,
      path: input.path,
      description: definition.data.description,
      default: definition.data.default,
      responses: definition.data.responses,
    })

    if (!result.ok) {
      return c.json({ error: 'laqi-control-plane', message: result.error }, 409)
    }

    return c.json({ id: result.id }, 201)
  })

  // Punto de inserción para las tareas 7–8: las rutas nuevas van ACÁ,
  // antes de este catch-all — nunca después.
  app.all('*', (c) =>
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `bun run test -- control-plane-app`
Expected: PASS, 14 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/control-plane-app.ts packages/server/src/control-plane-app.test.ts
git commit -m "feat(server): control plane — create an endpoint"
```

---

## Task 7: `packages/server` — control plane: editar y borrar endpoint

El id compuesto (`"GET /users/:id"`) viaja como un único path param `:id`, codificado con `encodeURIComponent` — verificado que `decodeURIComponent(c.req.param('id'))` lo recupera exacto.

**Files:**
- Modify: `packages/server/src/control-plane-app.ts`, `packages/server/src/control-plane-app.test.ts`

**Interfaces:**
- Consumes: nada nuevo
- Produces: `ControlPlaneRuntime` gana `updateEndpoint: (id: string, definition: { description?: string; default: string; responses: Record<string, unknown> }) => { ok: true } | { ok: false; error: string }` y `deleteEndpoint: (id: string) => { ok: true } | { ok: false; error: string }`

- [ ] **Step 1: Escribir el test que falla**

Añadir a `packages/server/src/control-plane-app.test.ts`:

```ts
describe('PUT /api/endpoints/:id', () => {
  it('updates the endpoint addressed by the URL-encoded id', async () => {
    const updateEndpoint = vi.fn(() => ({ ok: true as const }))
    const app = createControlPlaneApp(makeRuntime({ updateEndpoint }))

    const res = await app.request(`/api/endpoints/${encodeURIComponent('GET /users')}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ default: 'empty', responses: { empty: { status: 200, body: [] } } }),
    })

    expect(res.status).toBe(200)
    expect(updateEndpoint).toHaveBeenCalledWith('GET /users', {
      description: undefined,
      default: 'empty',
      responses: { empty: { status: 200, body: [] } },
    })
  })

  it('returns 404 when the runtime reports the id does not exist', async () => {
    const updateEndpoint = vi.fn(() => ({ ok: false as const, error: 'no endpoint "GET /ghost"' }))
    const app = createControlPlaneApp(makeRuntime({ updateEndpoint }))

    const res = await app.request(`/api/endpoints/${encodeURIComponent('GET /ghost')}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ default: 'ok', responses: { ok: { status: 200 } } }),
    })

    expect(res.status).toBe(404)
  })

  it('rejects an invalid definition with 400', async () => {
    const updateEndpoint = vi.fn()
    const app = createControlPlaneApp(makeRuntime({ updateEndpoint }))

    const res = await app.request(`/api/endpoints/${encodeURIComponent('GET /users')}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ default: 'ok', responses: {} }),
    })

    expect(res.status).toBe(400)
    expect(updateEndpoint).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/endpoints/:id', () => {
  it('deletes the endpoint and returns 204', async () => {
    const deleteEndpoint = vi.fn(() => ({ ok: true as const }))
    const app = createControlPlaneApp(makeRuntime({ deleteEndpoint }))

    const res = await app.request(`/api/endpoints/${encodeURIComponent('GET /users')}`, { method: 'DELETE' })

    expect(res.status).toBe(204)
    expect(deleteEndpoint).toHaveBeenCalledWith('GET /users')
  })

  it('returns 404 when the id does not exist', async () => {
    const deleteEndpoint = vi.fn(() => ({ ok: false as const, error: 'no endpoint "GET /ghost"' }))
    const app = createControlPlaneApp(makeRuntime({ deleteEndpoint }))

    const res = await app.request(`/api/endpoints/${encodeURIComponent('GET /ghost')}`, { method: 'DELETE' })
    expect(res.status).toBe(404)
  })
})
```

Y agregar `updateEndpoint`/`deleteEndpoint` al `makeRuntime` default:

```ts
    createEndpoint: () => ({ ok: true, id: 'GET /new' }),
    updateEndpoint: () => ({ ok: true }),
    deleteEndpoint: () => ({ ok: true }),
    ...overrides,
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `bun run test -- control-plane-app`
Expected: FAIL — ninguna de las dos rutas existe todavía.

- [ ] **Step 3: Implementar**

Agregar al tipo:

```ts
  updateEndpoint: (
    id: string,
    definition: { description?: string; default: string; responses: Record<string, unknown> },
  ) => { ok: true } | { ok: false; error: string }
  deleteEndpoint: (id: string) => { ok: true } | { ok: false; error: string }
```

Reemplazar el marcador de inserción:

```ts
  // Punto de inserción para las tareas 7–8: las rutas nuevas van ACÁ,
  // antes de este catch-all — nunca después.
  app.all('*', (c) =>
```

por:

```ts
  app.put('/api/endpoints/:id', async (c) => {
    const id = decodeURIComponent(c.req.param('id'))

    let raw: unknown
    try {
      raw = await c.req.json()
    } catch {
      return c.json({ error: 'laqi-control-plane', message: 'body is not valid JSON' }, 400)
    }

    const definition = EndpointSchema.safeParse(raw)
    if (!definition.success) {
      return c.json(
        { error: 'laqi-control-plane', message: definition.error.issues.map((i) => i.message).join('; ') },
        400,
      )
    }

    const result = runtime.updateEndpoint(id, definition.data)
    if (!result.ok) {
      return c.json({ error: 'laqi-control-plane', message: result.error }, 404)
    }

    return c.json({ ok: true })
  })

  app.delete('/api/endpoints/:id', (c) => {
    const id = decodeURIComponent(c.req.param('id'))
    const result = runtime.deleteEndpoint(id)

    if (!result.ok) {
      return c.json({ error: 'laqi-control-plane', message: result.error }, 404)
    }

    return c.body(null, 204)
  })

  // Punto de inserción para la Tarea 8 (SSE): la ruta nueva va ACÁ,
  // antes de este catch-all — nunca después.
  app.all('*', (c) =>
```

> Nota: no hace falta `.pick()`. `EndpointSchema` (Plan 1,
> `packages/schema/src/endpoint.ts`) ya tiene exactamente esta forma —
> `{ description?, default, responses }` — porque `method`/`path` nunca
> fueron parte de ese schema (viajan en la URL, no en la definición). Usar
> `EndpointSchema.safeParse(raw)` directo además mantiene viva la validación
> cruzada del `.superRefine` (que `default` exista entre `responses`) para
> el body del PUT, que es estrictamente mejor.
>
> **Se verificó, ejecutando Zod 4.3.6 de verdad, que `.pick()` NO es una
> opción acá**: sobre un schema construido con `z.object({...}).superRefine(...)`,
> `.pick()` **lanza una excepción** ("`.pick()` cannot be used on object
> schemas containing refinements"), no silenciosamente pierde la validación
> cruzada como podría parecer razonable asumir. Si algún cambio futuro
> necesitara un subconjunto de campos de un schema con `.superRefine()`
> encadenado, la solución es definir un schema aparte para ese subconjunto,
> nunca `.pick()`.

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `bun run test -- control-plane-app`
Expected: PASS, 19 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/control-plane-app.ts packages/server/src/control-plane-app.test.ts
git commit -m "feat(server): control plane — update and delete an endpoint"
```


## Task 8: `packages/server` — control plane: stream de eventos (SSE)

Verificado antes de escribir este plan: `streamSSE` de `hono/streaming` entrega los eventos correctamente sobre `@hono/node-server`, y `stream.onAbort()` limpia el listener del bus al desconectar el cliente — confirmado bajo Node real, que es donde corren los tests de este repo.

**Files:**
- Modify: `packages/server/src/control-plane-app.ts`, `packages/server/src/control-plane-app.test.ts`

**Interfaces:**
- Consumes: `type LaqiEvent` (`@laqi/core`, Tarea 1)
- Produces: `ControlPlaneRuntime` gana `subscribe: (listener: (event: LaqiEvent) => void) => () => void`

- [ ] **Step 1: Escribir el test que falla**

Añadir a `packages/server/src/control-plane-app.test.ts`:

```ts
describe('GET /events (SSE)', () => {
  it('streams events emitted after the connection opens', async () => {
    let emit: ((event: LaqiEvent) => void) | undefined
    const app = createControlPlaneApp(
      makeRuntime({
        subscribe: (listener) => {
          emit = listener
          return () => {
            emit = undefined
          }
        },
      }),
    )

    const res = await app.request('/events')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')

    const reader = res.body!.getReader()
    const decoder = new TextDecoder()

    // El handler recién queda "conectado" cuando terminó de registrar el
    // listener — darle una vuelta de microtask antes de emitir.
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(emit).toBeDefined()

    emit!({ type: 'endpoints-changed', endpointCount: 5 })

    const { value } = await reader.read()
    const text = decoder.decode(value)
    expect(text).toContain('event: endpoints-changed')
    expect(text).toContain(JSON.stringify({ type: 'endpoints-changed', endpointCount: 5 }))

    await reader.cancel()
  })

  it('unsubscribes when the client disconnects', async () => {
    let unsubscribed = false
    const app = createControlPlaneApp(
      makeRuntime({
        subscribe: () => () => {
          unsubscribed = true
        },
      }),
    )

    const res = await app.request('/events')
    const reader = res.body!.getReader()
    await new Promise((resolve) => setTimeout(resolve, 10))

    await reader.cancel()
    // 150ms: 5x el intervalo de poll de 30ms del handler SSE, margen de
    // sobra para no ser un test frágil por estar justo en el borde.
    await new Promise((resolve) => setTimeout(resolve, 150))

    expect(unsubscribed).toBe(true)
  })
})
```

Y agregar `subscribe` al `makeRuntime` default e importar `LaqiEvent`:

```ts
import type { LaqiEvent, LoadedEndpoint, LoadError } from '@laqi/core'
```

```ts
    updateEndpoint: () => ({ ok: true }),
    deleteEndpoint: () => ({ ok: true }),
    subscribe: () => () => {},
    ...overrides,
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `bun run test -- control-plane-app`
Expected: FAIL — `/events` no existe, cae en el catch-all (404, no 200 con `text/event-stream`).

- [ ] **Step 3: Implementar**

Reemplazar las dos líneas de import del inicio del archivo (tal como quedaron tras la Tarea 6):

```ts
import type { LoadedEndpoint, LoadError } from '@laqi/core'
import { EndpointSchema, isHttpMethod, StateSchema, type HttpMethod, type LaqiState, type Scenarios } from '@laqi/schema'
import { Hono } from 'hono'
```

por (agrega `LaqiEvent` al primer import, y una línea nueva para `streamSSE`):

```ts
import type { LaqiEvent, LoadedEndpoint, LoadError } from '@laqi/core'
import { EndpointSchema, isHttpMethod, StateSchema, type HttpMethod, type LaqiState, type Scenarios } from '@laqi/schema'
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
```

Agregar al tipo:

```ts
  subscribe: (listener: (event: LaqiEvent) => void) => () => void
```

Reemplazar el marcador de inserción:

```ts
  // Punto de inserción para la Tarea 8 (SSE): la ruta nueva va ACÁ,
  // antes de este catch-all — nunca después.
  app.all('*', (c) =>
```

por:

```ts
  app.get('/events', (c) =>
    streamSSE(c, async (stream) => {
      let closed = false
      stream.onAbort(() => {
        closed = true
      })

      const unsubscribe = runtime.subscribe((event) => {
        void stream.writeSSE({ event: event.type, data: JSON.stringify(event) })
      })

      try {
        // 30ms, no 1000ms: el loop existe sólo para mantener vivo el
        // generador mientras la conexión sigue abierta; el intervalo es la
        // latencia máxima antes de notar un abort y desuscribirse. Verificado
        // durante la ejecución: a 1000ms, el test de desconexión (que sólo
        // espera 150ms tras el cancel) fallaba de forma determinista aunque
        // onAbort disparaba correctamente — el cleanup real ocurría, sólo
        // que tarde.
        while (!closed) {
          await stream.sleep(30)
        }
      } finally {
        unsubscribe()
      }
    }),
  )

  // Punto de inserción para futuras rutas: van ACÁ, antes de este
  // catch-all — nunca después.
  app.all('*', (c) =>
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `bun run test -- control-plane-app`
Expected: PASS, 21 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/control-plane-app.ts packages/server/src/control-plane-app.test.ts
git commit -m "feat(server): control plane — live SSE stream of requests, reloads and errors"
```

---

## Task 9: `packages/server` — `mock-app.ts` emite eventos de request

**Files:**
- Modify: `packages/server/src/mock-app.ts`, `packages/server/src/mock-app.test.ts`, `packages/server/src/index.ts`

**Interfaces:**
- Consumes: `type LaqiEvent` (`@laqi/core`, Tarea 1)
- Produces: `MockRuntime` gana `onRequest?: (event: LaqiEvent) => void`, llamado tras resolver cada respuesta (éxito o 500), nunca en el 404 del catch-all (ese no corresponde a ningún endpoint declarado)

- [ ] **Step 1: Escribir el test que falla**

Añadir a `packages/server/src/mock-app.test.ts`:

```ts
describe('onRequest', () => {
  it('fires with method, path, status, resolved layer/name and timing after a successful response', async () => {
    const onRequest = vi.fn()
    const app = makeApp(undefined, undefined, { onRequest })

    await app.request('/users')

    expect(onRequest).toHaveBeenCalledTimes(1)
    const event = onRequest.mock.calls[0]![0]
    expect(event).toMatchObject({
      type: 'request',
      method: 'GET',
      path: '/users',
      status: 200,
      resolvedName: 'ok',
      resolvedLayer: 'default',
    })
    expect(typeof event.ms).toBe('number')
    expect(event.ms).toBeGreaterThanOrEqual(0)
  })

  it('fires on a resolution failure too (500), not just on success', async () => {
    const onRequest = vi.fn()
    const state = { scenario: null, overrides: { 'GET /users': 'ghost' } }
    const app = makeApp(state, undefined, { onRequest })

    await app.request('/users')

    expect(onRequest).toHaveBeenCalledTimes(1)
    expect(onRequest.mock.calls[0]![0]).toMatchObject({ type: 'request', status: 500 })
  })

  it('does not fire for a request that matches no endpoint at all', async () => {
    const onRequest = vi.fn()
    const app = makeApp(undefined, undefined, { onRequest })

    await app.request('/typo')

    expect(onRequest).not.toHaveBeenCalled()
  })

  it('is optional — omitting it does not throw', async () => {
    const app = makeApp()
    const res = await app.request('/users')
    expect(res.status).toBe(200)
  })
})
```

En `packages/server/src/mock-app.test.ts`, reemplazar el helper `makeApp` (línea 41 del archivo actual):

```ts
function makeApp(state: LaqiState = { scenario: null, overrides: {} }, scenarios: Scenarios = {}) {
  const { table } = buildRouteTable(endpoints)
  const runtime: MockRuntime = { table, scenarios, getState: () => state, cors: '*' }
  return createMockApp(runtime)
}
```

por:

```ts
function makeApp(
  state: LaqiState = { scenario: null, overrides: {} },
  scenarios: Scenarios = {},
  overrides: Partial<MockRuntime> = {},
) {
  const { table } = buildRouteTable(endpoints)
  const runtime: MockRuntime = { table, scenarios, getState: () => state, cors: '*', ...overrides }
  return createMockApp(runtime)
}
```

Todos los call-sites existentes (`makeApp()`, `makeApp(state)`, `makeApp(state, scenarios)`) siguen funcionando igual, porque `overrides` es opcional con default `{}`.

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `bun run test -- mock-app`
Expected: FAIL — `onRequest` no es un campo reconocido, o simplemente nunca se llama (los `expect(onRequest).toHaveBeenCalledTimes(1)` fallan con 0 llamadas).

- [ ] **Step 3: Implementar**

En `packages/server/src/mock-app.ts`, agregar el import y el campo al tipo:

```ts
import type { LaqiEvent } from '@laqi/core'
```

```ts
export type MockRuntime = {
  table: RouteTable
  scenarios: Scenarios
  /** Función, no valor: el estado cambia sin que cambie la tabla de rutas. */
  getState: () => LaqiState
  cors: LaqiConfig['cors']
  /** Opcional: si está, se llama tras resolver cada respuesta (éxito o 500). */
  onRequest?: (event: LaqiEvent) => void
}
```

Reemplazar el cuerpo completo de `registerEndpoint` (el handler que registra cada endpoint, sin tocar nada de lo que está antes o después en el archivo — el split OPTIONS/cors y el catch-all de 404 quedan intactos). El bloque actual es:

```ts
  const registerEndpoint = (endpoint: LoadedEndpoint) => {
    app.on(endpoint.method, endpoint.path, async (c) => {
      const resolution = resolveResponse({
        endpoint,
        state: runtime.getState(),
        scenarios: runtime.scenarios,
        headerResponse: c.req.header(RESPONSE_HEADER),
        headerScenario: c.req.header(SCENARIO_HEADER),
      })

      // Un selector inexistente es un 500 explícito. Jamás una request colgada.
      if (!resolution.ok) {
        c.header(RESOLVED_HEADER, formatResolvedHeader(resolution))
        return c.json({ error: 'laqi', endpoint: endpoint.id, message: resolution.message }, 500)
      }

      const { response } = resolution

      if (response.delay) {
        await new Promise((resolve) => setTimeout(resolve, response.delay))
      }

      for (const [name, value] of Object.entries(response.headers ?? {})) {
        c.header(name, value)
      }

      // Se fija DESPUÉS de los headers del mock: uno declarado como
      // "X-Laqi-Resolved" nunca puede mentir sobre la capa que decidió.
      c.header(RESOLVED_HEADER, formatResolvedHeader(resolution))

      if (response.body === undefined) {
        return c.body(null, response.status as StatusCode)
      }

      // structuredClone: el cuerpo servido nunca es la referencia cargada.
      return c.json(structuredClone(response.body), response.status as ContentfulStatusCode)
    })
  }
```

Reemplazarlo por:

```ts
  const registerEndpoint = (endpoint: LoadedEndpoint) => {
    app.on(endpoint.method, endpoint.path, async (c) => {
      const startedAt = Date.now()
      const resolution = resolveResponse({
        endpoint,
        state: runtime.getState(),
        scenarios: runtime.scenarios,
        headerResponse: c.req.header(RESPONSE_HEADER),
        headerScenario: c.req.header(SCENARIO_HEADER),
      })

      const emit = (status: number) => {
        runtime.onRequest?.({
          type: 'request',
          method: endpoint.method,
          path: endpoint.path,
          status,
          resolvedName: resolution.name,
          resolvedLayer: resolution.layer,
          ms: Date.now() - startedAt,
        })
      }

      // Un selector inexistente es un 500 explícito. Jamás una request colgada.
      if (!resolution.ok) {
        c.header(RESOLVED_HEADER, formatResolvedHeader(resolution))
        emit(500)
        return c.json({ error: 'laqi', endpoint: endpoint.id, message: resolution.message }, 500)
      }

      const { response } = resolution

      if (response.delay) {
        await new Promise((resolve) => setTimeout(resolve, response.delay))
      }

      for (const [name, value] of Object.entries(response.headers ?? {})) {
        c.header(name, value)
      }

      // Se fija DESPUÉS de los headers del mock: uno declarado como
      // "X-Laqi-Resolved" nunca puede mentir sobre la capa que decidió.
      c.header(RESOLVED_HEADER, formatResolvedHeader(resolution))
      emit(response.status)

      if (response.body === undefined) {
        return c.body(null, response.status as StatusCode)
      }

      // structuredClone: el cuerpo servido nunca es la referencia cargada.
      return c.json(structuredClone(response.body), response.status as ContentfulStatusCode)
    })
  }
```

El resto del archivo (el split OPTIONS/cors del Plan 1, el catch-all de 404) no cambia.

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `bun run test -- mock-app`
Expected: PASS. Confirmar además que el resto de los tests de `mock-app.test.ts` (los del Plan 1) siguen pasando sin tocarlos.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/mock-app.ts packages/server/src/mock-app.test.ts
git commit -m "feat(server): mock-app emits a request event after resolving every response"
```

- [ ] **Step 6: Exportar `control-plane-app` desde el índice del paquete**

```ts
// packages/server/src/index.ts
export * from './mock-app'
export * from './control-plane-app'
```

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/index.ts
git commit -m "feat(server): export the control plane app from @laqi/server"
```


## Task 10: `apps/cli` — componer control plane + mock app, conectar el bus

Esta es la tarea de integración: junta todo lo anterior en el servidor real. Reusa el hot-swap del Plan 1 sin tocar su forma — sólo hace que `buildApp()` construya dos apps en vez de una, y que `reload()` también emita eventos.

**Files:**
- Modify: `apps/cli/src/serve.ts`, `apps/cli/src/serve.test.ts`

**Interfaces:**
- Consumes: `EventBus`, `type LaqiEvent`, `createEndpointInFile`, `updateEndpointInFile`, `deleteEndpointFromFile`, `type WriteResult` (`@laqi/core`, Tareas 1–3); `createControlPlaneApp`, `type ControlPlaneRuntime`, `createMockApp` (`@laqi/server`, Tareas 4–9); `formatEndpointId`, `type HttpMethod` (`@laqi/schema`, Plan 1)
- Produces: `ServeHandle` no cambia de forma (mismos campos: `port`, `host`, `reload`, `current`, `close`) — pero ahora `app` (interno, no exportado) sirve mocks y control plane a la vez

- [ ] **Step 1: Escribir el test que falla**

Añadir a `apps/cli/src/serve.test.ts` (después de los tests existentes del Plan 1):

```ts
describe('control plane, mounted under /__laqi', () => {
  it('lists the loaded endpoints', async () => {
    writeMocks({ 'GET /users': { default: 'ok', responses: { ok: { status: 200, body: [] } } } })
    handle = await startServer({ root, config })

    const res = await get('/__laqi/api/endpoints')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { id: string }[]
    expect(body.map((e) => e.id)).toEqual(['GET /users'])
  })

  it('flips the live response via PUT /api/state, and the mock reflects it immediately', async () => {
    writeMocks({
      'GET /users': {
        default: 'ok',
        responses: { ok: { status: 200, body: [] }, boom: { status: 500, body: {} } },
      },
    })
    handle = await startServer({ root, config })

    const put = await fetch(`http://127.0.0.1:${handle!.port}/__laqi/api/state`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scenario: null, overrides: { 'GET /users': 'boom' } }),
    })
    expect(put.status).toBe(200)

    const res = await get('/users')
    expect(res.status).toBe(500)
    expect(res.headers.get('X-Laqi-Resolved')).toBe('boom (state)')
  })

  it('creates an endpoint via POST, and it is immediately servable — no restart, no wait for the watcher', async () => {
    writeMocks({ 'GET /users': { default: 'ok', responses: { ok: { status: 200, body: [] } } } })
    handle = await startServer({ root, config })

    const post = await fetch(`http://127.0.0.1:${handle!.port}/__laqi/api/endpoints`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        method: 'GET',
        path: '/orders',
        default: 'ok',
        responses: { ok: { status: 200, body: [] } },
      }),
    })
    expect(post.status).toBe(201)

    const res = await get('/orders')
    expect(res.status).toBe(200)
  })

  it('updates an endpoint via PUT, immediately reflected', async () => {
    writeMocks({
      'GET /users': { default: 'ok', responses: { ok: { status: 200, body: [{ id: 1 }] } } },
    })
    handle = await startServer({ root, config })

    const put = await fetch(
      `http://127.0.0.1:${handle!.port}/__laqi/api/endpoints/${encodeURIComponent('GET /users')}`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ default: 'ok', responses: { ok: { status: 200, body: [] } } }),
      },
    )
    expect(put.status).toBe(200)

    const res = await get('/users')
    expect(await res.json()).toEqual([])
  })

  it('deletes an endpoint via DELETE, immediately gone', async () => {
    writeMocks({
      'GET /users': { default: 'ok', responses: { ok: { status: 200, body: [] } } },
      'GET /orders': { default: 'ok', responses: { ok: { status: 200, body: [] } } },
    })
    handle = await startServer({ root, config })

    const del = await fetch(
      `http://127.0.0.1:${handle!.port}/__laqi/api/endpoints/${encodeURIComponent('GET /orders')}`,
      { method: 'DELETE' },
    )
    expect(del.status).toBe(204)

    expect((await get('/orders')).status).toBe(404)
    expect((await get('/users')).status).toBe(200)
  })

  it('streams a request event over SSE when a mock is hit', async () => {
    writeMocks({ 'GET /users': { default: 'ok', responses: { ok: { status: 200, body: [] } } } })
    handle = await startServer({ root, config })

    const sse = await fetch(`http://127.0.0.1:${handle!.port}/__laqi/events`)
    const reader = sse.body!.getReader()
    const decoder = new TextDecoder()

    await new Promise((resolve) => setTimeout(resolve, 20))
    await get('/users')

    const { value } = await reader.read()
    const text = decoder.decode(value)
    expect(text).toContain('event: request')
    expect(text).toContain('"path":"/users"')

    await reader.cancel()
  })

  it('a mock endpoint can never be created under the reserved /__laqi prefix', async () => {
    handle = await startServer({ root, config })

    const post = await fetch(`http://127.0.0.1:${handle!.port}/__laqi/api/endpoints`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        method: 'GET',
        path: '/__laqi/panel',
        default: 'ok',
        responses: { ok: { status: 200, body: {} } },
      }),
    })

    // La ruta de creación en sí no valida el prefijo reservado (eso lo hace
    // parseEndpointKey al CARGAR, Plan 1) — pero el archivo sí queda escrito,
    // y la recarga inmediata debe reportar el error de LOAD FAILED en vez
    // de registrar el endpoint.
    expect(post.status).toBe(201)
    const status = await (await get('/__laqi/api/status')).json()
    expect((status as { errors: unknown[] }).errors.length).toBeGreaterThan(0)
    expect((await get('/__laqi/panel')).status).not.toBe(200)
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `bun run test -- serve`
Expected: FAIL — todas las requests a `/__laqi/*` devuelven 404 (el `app.all('*', ...)` del mock-app, porque el control plane todavía no está montado).

- [ ] **Step 3: Implementar**

Reemplazar el contenido completo de `apps/cli/src/serve.ts`:

```ts
// apps/cli/src/serve.ts
import { join } from 'node:path'
import { serve, type ServerType } from '@hono/node-server'
import {
  createEndpointInFile,
  deleteEndpointFromFile,
  EventBus,
  StateStore,
  updateEndpointInFile,
  type WriteResult,
} from '@laqi/core'
import { formatEndpointId, isHttpMethod, type HttpMethod, type LaqiConfig } from '@laqi/schema'
import { createControlPlaneApp, createMockApp, type ControlPlaneRuntime } from '@laqi/server'
import { Hono } from 'hono'
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
  const bus = new EventBus()

  let runtime = buildRuntime(root, config)
  let app: Hono = buildApp()

  function reload(): Runtime {
    runtime = buildRuntime(root, config)
    app = buildApp()
    bus.emit({ type: 'endpoints-changed', endpointCount: runtime.table.endpoints.length })
    for (const error of runtime.errors) {
      bus.emit({
        type: 'error',
        file: error.file,
        line: error.line,
        col: error.col,
        message: error.message,
        excerpt: error.excerpt,
      })
    }
    return runtime
  }

  function targetFileForNewEndpoint(): string {
    return runtime.source === 'file' ? config.file : join(config.dir, 'api.json')
  }

  function buildApp(): Hono {
    const mockApp = createMockApp({
      table: runtime.table,
      scenarios: runtime.scenarios,
      // Se lee en cada request: el panel cambia el estado sin tocar archivos.
      getState: () => store.read(),
      cors: config.cors,
      onRequest: (event) => bus.emit(event),
    })

    const controlPlaneRuntime: ControlPlaneRuntime = {
      getEndpoints: () => runtime.table.endpoints,
      getState: () => store.read(),
      setState: (state) => store.write(state),
      getScenarios: () => runtime.scenarios,
      getStatus: () => ({
        watching: runtime.source === 'file' ? config.file : config.dir,
        endpointCount: runtime.table.endpoints.length,
        address: `${config.host}:${config.port}`,
        errors: runtime.errors,
      }),
      createEndpoint: (input) => {
        const method = input.method.toUpperCase()
        if (!isHttpMethod(method)) return { ok: false, error: `unknown method ${JSON.stringify(input.method)}` }

        const id = formatEndpointId(method as HttpMethod, input.path)
        const result: WriteResult = createEndpointInFile({
          root,
          file: targetFileForNewEndpoint(),
          id,
          definition: { description: input.description, default: input.default, responses: input.responses },
        })

        if (!result.ok) return result
        reload()
        return { ok: true, id }
      },
      updateEndpoint: (id, definition) => {
        const existing = runtime.table.byId.get(id)
        if (!existing) return { ok: false, error: `no endpoint with id ${JSON.stringify(id)}` }

        const result = updateEndpointInFile({ root, file: existing.file, id, definition })
        if (result.ok) reload()
        return result
      },
      deleteEndpoint: (id) => {
        const existing = runtime.table.byId.get(id)
        if (!existing) return { ok: false, error: `no endpoint with id ${JSON.stringify(id)}` }

        const result = deleteEndpointFromFile({ root, file: existing.file, id })
        if (result.ok) reload()
        return result
      },
      subscribe: (listener) => bus.subscribe(listener),
    }
    const controlPlaneApp = createControlPlaneApp(controlPlaneRuntime)

    const top = new Hono()
    top.route('/__laqi', controlPlaneApp)
    top.route('/', mockApp)
    return top
  }

  const server: ServerType = await new Promise((resolve, reject) => {
    const instance = serve(
      {
        // La indirección es el punto: `app` es mutable, el servidor no.
        fetch: (request: Request) => app.fetch(request),
        port: config.port,
        hostname: config.host,
      },
      () => resolve(instance),
    )
    // Sin esto, un puerto ocupado (EADDRINUSE) nunca dispara el callback de
    // éxito y la promesa cuelga para siempre, en silencio.
    instance.on('error', reject)
  })

  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : config.port

  return {
    port,
    host: config.host,
    current: () => runtime,
    reload,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      }),
  }
}
```

> Nota sobre la Tarea 9's `onRequest`: `createMockApp` ya lo declara opcional
> (`onRequest?: (event: LaqiEvent) => void`) — pasarlo acá como
> `(event) => bus.emit(event)` es válido porque `LaqiEvent` (el tipo que
> emite `mock-app.ts`) y el que espera `EventBus.emit` son el mismo tipo,
> reexportado desde `@laqi/core`.

> Nota sobre el test "no puede crearse bajo `/__laqi`": la ruta de creación
> del control plane (Tarea 6) no valida el prefijo reservado — sólo
> `parseEndpointKey`, que corre al CARGAR (`loadMocks`, Plan 1), lo hace.
> Es intencional: la validación vive en un solo lugar (el loader), no
> duplicada en cada escritor. El resultado es el mismo — el endpoint nunca
> queda servible — pero el error aparece en `/api/status`, no en la
> respuesta del `POST`. El Plan 2b debe mostrar ese error en la banda roja
> (F8) si el usuario intenta esto desde el editor.

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `bun run test -- serve`
Expected: PASS. Correr también la suite completa: `bun run test` (unfiltered) y `bun run check-types`, ya que esta tarea modifica un archivo que otras partes del sistema ya usan (`apps/cli/src/index.ts` importa `startServer` sin cambios en su firma, así que no debería romper nada — confirmarlo).

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/serve.ts apps/cli/src/serve.test.ts
git commit -m "feat(cli): mount the control plane alongside the mock server, wire the event bus"
```


## Task 11: Smoke test manual de punta a punta

Sin cambios de código — es la verificación final, a mano, de que todo el control plane funciona junto en un servidor real, incluido el SSE recibiendo eventos de un cliente `curl` real mientras otro cliente dispara requests.

**Files:** ninguno.

- [ ] **Step 1: Levantar un proyecto de prueba**

```bash
mkdir -p /tmp/laqi-cp-smoke/laqi && cd /tmp/laqi-cp-smoke
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
bun <ruta-al-repo>/apps/cli/src/index.ts &
```

- [ ] **Step 2: Conectar al SSE en una terminal y dejarlo corriendo**

```bash
curl -N http://127.0.0.1:8000/__laqi/events
```

- [ ] **Step 3: En otra terminal, ejercitar el control plane**

```bash
# leer
curl -s http://127.0.0.1:8000/__laqi/api/endpoints | jq
curl -s http://127.0.0.1:8000/__laqi/api/state | jq

# flipear el estado
curl -s -X PUT http://127.0.0.1:8000/__laqi/api/state \
  -H 'content-type: application/json' \
  -d '{"scenario":null,"overrides":{"GET /users":"boom"}}'
curl -i http://127.0.0.1:8000/users   # -> 500, X-Laqi-Resolved: boom (state)

# crear
curl -s -X POST http://127.0.0.1:8000/__laqi/api/endpoints \
  -H 'content-type: application/json' \
  -d '{"method":"GET","path":"/orders","default":"ok","responses":{"ok":{"status":200,"body":[]}}}'
curl -i http://127.0.0.1:8000/orders   # -> 200, sin reiniciar el proceso

# editar
curl -s -X PUT "http://127.0.0.1:8000/__laqi/api/endpoints/GET%20%2Forders" \
  -H 'content-type: application/json' \
  -d '{"default":"ok","responses":{"ok":{"status":200,"body":[{"n":1}]}}}'
curl -s http://127.0.0.1:8000/orders   # -> [{"n":1}]

# borrar
curl -i -X DELETE "http://127.0.0.1:8000/__laqi/api/endpoints/GET%20%2Forders"
curl -i http://127.0.0.1:8000/orders   # -> 404
```

- [ ] **Step 4: Verificar en la terminal del SSE (Step 2)**

Esperado: por cada `curl /users` y `/orders` de arriba, una línea `event: request` con el path y el status correctos; por cada create/update/delete, una línea `event: endpoints-changed` con el `endpointCount` actualizado.

- [ ] **Step 5: Confirmar que nada rompió el hot-reload de archivos**

```bash
echo '{"GET /health":{"default":"ok","responses":{"ok":{"status":200,"body":{}}}}}' > laqi/health.json
sleep 1
curl -i http://127.0.0.1:8000/health   # -> 200, sin haber pasado por el control plane
```

- [ ] **Step 6: Apagar el servidor limpio**

```bash
kill %1
```

- [ ] **Step 7: Correr toda la suite una última vez**

```bash
cd <ruta-al-repo>
bun run test && bun run check-types && bun run lint
```

Expected: todo verde.

---

## Fuera del alcance de este plan

- **El bloqueo del túnel** (que `/__laqi/*` nunca salga por la URL pública). Este plan sólo entrega la separación estructural (`createControlPlaneApp` ≠ `createMockApp`) que lo hace posible. El mecanismo real (cloudflared, proxy, lo que sea) es el Plan 4.
- **`share-changed`** como evento del bus — pertenece al Plan 4, no existe todavía nada que lo emita.
- **Autenticación del control plane.** Hoy, cualquiera que llegue a `127.0.0.1:PORT/__laqi/*` puede leer y escribir mocks. Es aceptable porque hoy sólo escucha en local — el Plan 4, al agregar `--share`, es quien tiene que decidir si el control plane necesita su propio token cuando el modo compartido está activo (ADR-0007 ya lo exige para el servidor de mocks; el control plane nunca debería ni siquiera ser alcanzable desde ahí, así que la pregunta de autenticarlo es secundaria a bloquearlo).
- **Autoría de escenarios** (crear/editar `scenarios.json`) — el [ADR-0008](../decisiones/0008-multiarchivo-y-nombres.md) ya decidió que eso es a mano o vía MCP (Plan 3), nunca desde el panel. `GET /api/scenarios` es de sólo lectura a propósito.
- **El editor web en sí** (`packages/editor`) — es el Plan 2b, consume esta API.

## Definición de terminado

- [ ] `bun run test` verde: 11 tareas, 50 tests nuevos (7 events + 11 writer + 21 control-plane-app + 4 mock-app + 7 serve) sobre los 122 que ya existían — 172 en total
- [ ] `bun run check-types` y `bun run lint` sin errores
- [ ] `GET /__laqi/api/endpoints`, `GET`/`PUT /__laqi/api/state`, `GET /__laqi/api/scenarios`, `GET /__laqi/api/status` responden correctamente montados junto al mock server
- [ ] `POST`/`PUT`/`DELETE /__laqi/api/endpoints[/:id]` escriben de vuelta a los archivos y el cambio es servible **sin reiniciar el proceso**
- [ ] `GET /__laqi/events` entrega SSE en vivo: `request` por cada mock servido, `endpoints-changed` y `error` tras cada recarga (ya sea por escritura del control plane o por edición manual de un archivo)
- [ ] Ningún mock puede registrarse bajo `/__laqi` (ya garantizado desde el Plan 1, verificado de nuevo acá con un test de integración)
- [ ] `createControlPlaneApp` y `createMockApp` siguen siendo dos apps Hono genuinamente separadas — nunca fusionadas en un solo archivo de rutas
