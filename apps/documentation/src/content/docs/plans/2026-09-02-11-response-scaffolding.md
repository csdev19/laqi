---
title: "Plan 11 — Response scaffolding on create: the status catalogue and the usual siblings"
---

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop making people type status codes from memory and stop making them create the same four responses by hand: a status field that names every code it offers, and a one-click scaffold of the response family the method and path shape imply — in the panel and over MCP, from one shared definition.

**Architecture:** Both features are pure data plus one pure function, so both live in `@laqi/schema` — the only shared package that is already browser-safe (zod and nothing else; `packages/editor` imports `MockResponse` from it today). `packages/editor` renders them, `packages/mcp` exposes the scaffold as a tool, and neither one owns a copy of the table. No new control-plane route: the scaffold produces a `responses` object, and `POST /api/endpoints` / `PUT /api/endpoints/:id` already accept exactly that.

**Tech Stack:** TypeScript, zod (already in `@laqi/schema`), React 19 + Vitest/jsdom + `@testing-library/react` (already in `packages/editor`), `@modelcontextprotocol/sdk` + zod (already in `packages/mcp`).

**Spec:** `apps/documentation/src/content/docs/product/roadmap.md` — the "Suggested responses on create" and "Status-code select on create" sections under **Next**. The roadmap names them siblings; this plan builds them as one, because they share the form, the response type, and the MCP surface.

## Global Constraints

- **English everywhere** in code, comments, identifiers, test names, commit messages and docs (ADR-0009 and the user's standing instruction).
- **`@laqi/schema` stays browser-safe.** No `node:` import, no filesystem, no dependency beyond `zod`. `packages/editor` bundles it for the browser; a `node:` import there breaks the panel build, not a test.
- **One definition of the status vocabulary.** After Task 1, `statusClass` exists in exactly one file. `packages/editor/src/log.ts` re-exports it rather than declaring its own — today there are two and they are allowed to drift.
- **Free text stays possible in the status field.** The select is a combobox, not a closed `<select>`: a mock server must be able to return `599` or any other code a real backend emits. Any change that makes an unlisted code unenterable is a regression.
- **The scaffold never overwrites.** It only adds response names that do not already exist. Silently replacing a body someone wrote is data loss.
- **`204` carries no body.** Not `{}`, not `null` — the key is absent. A 204 with a body is malformed HTTP and `packages/server` should never be asked to send one.
- **TDD throughout.** Every task writes the failing test first and runs it to watch it fail. Run tests with `bun run test`, or scope with `bunx vitest run <path>`.
- **Follow existing conventions:** Conventional Commit messages, `bun run check:ci` (oxlint + oxfmt) clean before every commit, PR-only workflow — no local merges, no direct pushes to `main`.
- **Out of scope:** observing a real 200 in the request log and offering the scaffold from there (the roadmap mentions it; it needs a request-log affordance that Plan 13 is building the terminal half of). This plan ships the panel create flow and MCP. Say so in the PR rather than let it read as complete.

---

## File structure

```
packages/schema/src/
├── status-codes.ts            # the catalogue + statusClass, the one definition
├── status-codes.test.ts
├── scaffold.ts                # suggestResponses(): method + path shape → the family
├── scaffold.test.ts
└── index.ts                   # modify: export both

packages/editor/src/
├── components/
│   ├── StatusSelect.tsx       # combobox: type-to-filter, grouped, free text kept
│   ├── StatusSelect.test.tsx
│   ├── CreateEndpointRow.tsx  # modify: the status input becomes StatusSelect
│   ├── EndpointDetail.tsx     # modify: #meta-status becomes StatusSelect, + the scaffold button
│   └── EndpointDetail.test.tsx
├── log.ts                     # modify: re-export statusClass instead of declaring it
└── styles.css                 # modify: .status-select rules

packages/mcp/src/
├── server.ts                  # modify: register scaffold_responses
└── stdio.test.ts              # modify: cover it over real stdio
```

Two files carry all the shared knowledge. `status-codes.ts` answers "what codes exist and what are they called"; `scaffold.ts` answers "which responses does this endpoint probably want". Everything else renders one of the two.

---

## Task 1: The status-code catalogue, and one `statusClass`

**Files:**

- Create: `packages/schema/src/status-codes.ts`
- Create: `packages/schema/src/status-codes.test.ts`
- Modify: `packages/schema/src/index.ts`
- Modify: `packages/editor/src/log.ts:44-49` (delete the local `statusClass`, re-export)

**Interfaces:**

- Consumes: nothing.
- Produces:
  - `type StatusClass = 'ok' | 'redirect' | 'client' | 'server'`
  - `type StatusGroup = 'informational' | 'success' | 'redirection' | 'client error' | 'server error'`
  - `type StatusCode = { code: number; label: string; group: StatusGroup }`
  - `const STATUS_CODES: readonly StatusCode[]`
  - `function statusClass(status: number): StatusClass`
  - `function filterStatusCodes(query: string): readonly StatusCode[]`

- [ ] **Step 1: Write the failing test**

```ts
// packages/schema/src/status-codes.test.ts
import { describe, expect, it } from 'vitest'
import { filterStatusCodes, STATUS_CODES, statusClass } from './status-codes'

describe('STATUS_CODES', () => {
  it('is sorted by code and has no duplicates', () => {
    const codes = STATUS_CODES.map((entry) => entry.code)
    expect(codes).toEqual([...codes].sort((a, b) => a - b))
    expect(new Set(codes).size).toBe(codes.length)
  })

  it('names the codes the scaffold hands out, so the two surfaces agree', () => {
    // Every status suggestResponses can produce must be nameable in the
    // select. A scaffolded 422 that the dropdown cannot explain is a hole.
    for (const code of [200, 201, 204, 404, 409, 422, 500]) {
      expect(STATUS_CODES.find((entry) => entry.code === code)).toBeDefined()
    }
  })
})

describe('statusClass', () => {
  it('maps each range to the class the panel paints with', () => {
    expect(statusClass(100)).toBe('ok')
    expect(statusClass(200)).toBe('ok')
    expect(statusClass(301)).toBe('redirect')
    expect(statusClass(404)).toBe('client')
    expect(statusClass(500)).toBe('server')
  })
})

describe('filterStatusCodes', () => {
  it('returns everything for an empty query', () => {
    expect(filterStatusCodes('   ')).toHaveLength(STATUS_CODES.length)
  })

  it('finds a code by its digits', () => {
    expect(filterStatusCodes('404').map((entry) => entry.code)).toEqual([404])
  })

  it('finds a code by its name, case-insensitively', () => {
    expect(filterStatusCodes('not found').map((entry) => entry.code)).toEqual([404])
  })

  it('matches every typed token, in any order', () => {
    // "found not" and "not found" are the same intent; a user typing fast
    // gets the word order wrong and should still land on 404.
    expect(filterStatusCodes('found not').map((entry) => entry.code)).toEqual([404])
  })

  it('narrows progressively rather than jumping to one answer', () => {
    const partial = filterStatusCodes('not').map((entry) => entry.code)
    expect(partial).toContain(404)
    expect(partial).toContain(501)
    expect(partial.length).toBeGreaterThan(1)
  })

  it('returns nothing when a code is not in the catalogue', () => {
    // 599 is legal and enterable as free text, but it is not a named code.
    expect(filterStatusCodes('599')).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run packages/schema/src/status-codes.test.ts`
Expected: FAIL — `Failed to resolve import "./status-codes"`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/schema/src/status-codes.ts

/**
 * The four classes the panel paints with. This is the ONE definition —
 * `packages/editor/src/log.ts` used to carry a second copy, which is how a
 * chip and a log row could disagree about the same number.
 */
export type StatusClass = 'ok' | 'redirect' | 'client' | 'server'

/** The five RFC classes, spelled out for the select's group headings. */
export type StatusGroup =
  | 'informational'
  | 'success'
  | 'redirection'
  | 'client error'
  | 'server error'

export type StatusCode = {
  code: number
  /** The RFC reason phrase, e.g. `Not Found`. */
  label: string
  group: StatusGroup
}

/**
 * Curated, not exhaustive. Every code a mock server plausibly returns, and
 * nothing whose only appearance is in a proxy's changelog. Free text in the
 * select covers the rest, which is why this list can afford to be short
 * enough to scan.
 */
export const STATUS_CODES: readonly StatusCode[] = [
  { code: 100, label: 'Continue', group: 'informational' },
  { code: 101, label: 'Switching Protocols', group: 'informational' },

  { code: 200, label: 'OK', group: 'success' },
  { code: 201, label: 'Created', group: 'success' },
  { code: 202, label: 'Accepted', group: 'success' },
  { code: 204, label: 'No Content', group: 'success' },
  { code: 206, label: 'Partial Content', group: 'success' },

  { code: 301, label: 'Moved Permanently', group: 'redirection' },
  { code: 302, label: 'Found', group: 'redirection' },
  { code: 303, label: 'See Other', group: 'redirection' },
  { code: 304, label: 'Not Modified', group: 'redirection' },
  { code: 307, label: 'Temporary Redirect', group: 'redirection' },
  { code: 308, label: 'Permanent Redirect', group: 'redirection' },

  { code: 400, label: 'Bad Request', group: 'client error' },
  { code: 401, label: 'Unauthorized', group: 'client error' },
  { code: 403, label: 'Forbidden', group: 'client error' },
  { code: 404, label: 'Not Found', group: 'client error' },
  { code: 405, label: 'Method Not Allowed', group: 'client error' },
  { code: 409, label: 'Conflict', group: 'client error' },
  { code: 410, label: 'Gone', group: 'client error' },
  { code: 415, label: 'Unsupported Media Type', group: 'client error' },
  { code: 422, label: 'Unprocessable Entity', group: 'client error' },
  { code: 429, label: 'Too Many Requests', group: 'client error' },

  { code: 500, label: 'Internal Server Error', group: 'server error' },
  { code: 501, label: 'Not Implemented', group: 'server error' },
  { code: 502, label: 'Bad Gateway', group: 'server error' },
  { code: 503, label: 'Service Unavailable', group: 'server error' },
  { code: 504, label: 'Gateway Timeout', group: 'server error' },
]

/** The status class, which is the panel's second scan dimension. */
export function statusClass(status: number): StatusClass {
  if (status >= 500) return 'server'
  if (status >= 400) return 'client'
  if (status >= 300) return 'redirect'
  return 'ok'
}

/**
 * Every typed token has to appear in `<code> <label>`, in any order — so
 * `404`, `not found` and `found not` all reach the same row. Same rule the
 * command palette uses; a user who has learned one search has learned both.
 */
export function filterStatusCodes(query: string): readonly StatusCode[] {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return STATUS_CODES

  return STATUS_CODES.filter((entry) => {
    const target = `${entry.code} ${entry.label}`.toLowerCase()
    return tokens.every((token) => target.includes(token))
  })
}
```

- [ ] **Step 4: Export it from the barrel**

```ts
// packages/schema/src/index.ts — add to the existing list
export * from './status-codes'
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bunx vitest run packages/schema/src/status-codes.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 6: Collapse the duplicate `statusClass` in the panel**

Delete the local declaration at the bottom of `packages/editor/src/log.ts` and re-export the shared one in its place, so every existing importer keeps working unchanged:

```ts
// packages/editor/src/log.ts — replace the local statusClass declaration
/**
 * Re-exported, not redeclared. The definition lives in `@laqi/schema` so the
 * chip in the detail pane, the log row, and the create form cannot disagree
 * about what colour 404 is.
 */
export { statusClass } from '@laqi/schema'
```

- [ ] **Step 7: Run the panel suite to prove the re-export is transparent**

Run: `bunx vitest run packages/editor`
Expected: PASS — no test changes needed. If any fail, the two definitions had already drifted; fix the call site, not the shared function.

- [ ] **Step 8: Commit**

```bash
git add packages/schema/src/status-codes.ts packages/schema/src/status-codes.test.ts packages/schema/src/index.ts packages/editor/src/log.ts
git commit -m "feat(schema): add the status-code catalogue and one statusClass"
```

---

## Task 2: `suggestResponses` — the family a method and path shape imply

**Files:**

- Create: `packages/schema/src/scaffold.ts`
- Create: `packages/schema/src/scaffold.test.ts`
- Modify: `packages/schema/src/index.ts`

**Interfaces:**

- Consumes: `MockResponse` from `./response`, `HttpMethod`/`isHttpMethod` from `./method`.
- Produces:
  - `type ResponseSuggestion = { name: string; response: MockResponse }`
  - `function suggestResponses(input: { method: string; path: string; existing?: readonly string[] }): ResponseSuggestion[]`
  - `function hasPathParam(path: string): boolean`

The rule, which is the whole feature: **the method picks the family, the path shape prunes it.** `GET /orders` cannot 404 in any interesting way — it returns an empty list. `GET /orders/:id` is the one that 404s. Offering both to both is how a scaffold turns into noise people switch off.

| Method          | Path has `:param` | Suggested                                               |
| --------------- | ----------------- | ------------------------------------------------------- |
| `GET`           | no                | `ok` 200 · `empty` 200 · `error` 500                    |
| `GET`           | yes               | `ok` 200 · `not-found` 404 · `error` 500                |
| `POST`          | either            | `created` 201 · `validation-error` 422 · `conflict` 409 |
| `PUT` / `PATCH` | no                | `ok` 200 · `validation-error` 422                       |
| `PUT` / `PATCH` | yes               | `ok` 200 · `not-found` 404 · `conflict` 409             |
| `DELETE`        | no                | `deleted` 204                                           |
| `DELETE`        | yes               | `deleted` 204 · `not-found` 404                         |
| `HEAD`          | either            | `ok` 200                                                |
| `OPTIONS`       | either            | `ok` 204                                                |

- [ ] **Step 1: Write the failing test**

```ts
// packages/schema/src/scaffold.test.ts
import { describe, expect, it } from 'vitest'
import { hasPathParam, suggestResponses } from './scaffold'

const names = (input: Parameters<typeof suggestResponses>[0]) =>
  suggestResponses(input).map((suggestion) => suggestion.name)

describe('hasPathParam', () => {
  it('sees a colon segment', () => {
    expect(hasPathParam('/orders/:id')).toBe(true)
    expect(hasPathParam('/orders/:id/items')).toBe(true)
  })

  it('does not mistake a colon inside a literal segment for a param', () => {
    // A route pattern's param is a whole segment. `/a:b` is a literal path.
    expect(hasPathParam('/orders/a:b')).toBe(false)
    expect(hasPathParam('/orders')).toBe(false)
  })
})

describe('suggestResponses', () => {
  it('gives a collection GET an empty case, not a not-found', () => {
    expect(names({ method: 'GET', path: '/orders' })).toEqual(['ok', 'empty', 'error'])
  })

  it('gives an item GET a not-found, not an empty', () => {
    expect(names({ method: 'GET', path: '/orders/:id' })).toEqual(['ok', 'not-found', 'error'])
  })

  it('gives POST the create family regardless of path shape', () => {
    expect(names({ method: 'POST', path: '/orders' })).toEqual([
      'created',
      'validation-error',
      'conflict',
    ])
  })

  it('gives an item PUT a not-found and a conflict', () => {
    expect(names({ method: 'PUT', path: '/orders/:id' })).toEqual([
      'ok',
      'not-found',
      'conflict',
    ])
  })

  it('gives PATCH the same family as PUT', () => {
    expect(names({ method: 'PATCH', path: '/orders/:id' })).toEqual(
      names({ method: 'PUT', path: '/orders/:id' }),
    )
  })

  it('gives DELETE a 204 with no body key at all', () => {
    const suggestions = suggestResponses({ method: 'DELETE', path: '/orders/:id' })
    const deleted = suggestions.find((suggestion) => suggestion.name === 'deleted')
    expect(deleted?.response.status).toBe(204)
    // Not `body: undefined` — the key must be absent, or the writer emits
    // `"body": null` into the mock file and the server sends a body on a 204.
    expect(Object.hasOwn(deleted!.response, 'body')).toBe(false)
  })

  it('gives a collection GET an empty ARRAY, not an empty object', () => {
    const empty = suggestResponses({ method: 'GET', path: '/orders' }).find(
      (suggestion) => suggestion.name === 'empty',
    )
    expect(empty?.response.body).toEqual([])
  })

  it('writes failure bodies in the shape the example project already uses', () => {
    const notFound = suggestResponses({ method: 'GET', path: '/orders/:id' }).find(
      (suggestion) => suggestion.name === 'not-found',
    )
    expect(notFound?.response).toMatchObject({ status: 404, body: { message: expect.any(String) } })
  })

  it('never suggests a name the endpoint already has', () => {
    // The scaffold adds; it does not replace. Overwriting a body someone
    // wrote by hand is data loss, and it is silent.
    expect(names({ method: 'GET', path: '/orders/:id', existing: ['ok', 'error'] })).toEqual([
      'not-found',
    ])
  })

  it('returns nothing when the family is fully present', () => {
    expect(
      names({ method: 'DELETE', path: '/orders', existing: ['deleted'] }),
    ).toEqual([])
  })

  it('returns nothing for a method it has no opinion about', () => {
    expect(names({ method: 'TRACE', path: '/orders' })).toEqual([])
  })

  it('is case-insensitive about the method', () => {
    expect(names({ method: 'get', path: '/orders' })).toEqual(names({ method: 'GET', path: '/orders' }))
  })

  it('produces responses that satisfy the response schema', async () => {
    const { ResponseSchema } = await import('./response')
    for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']) {
      for (const path of ['/orders', '/orders/:id']) {
        for (const suggestion of suggestResponses({ method, path })) {
          expect(ResponseSchema.safeParse(suggestion.response).success).toBe(true)
        }
      }
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run packages/schema/src/scaffold.test.ts`
Expected: FAIL — `Failed to resolve import "./scaffold"`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/schema/src/scaffold.ts
import { isHttpMethod } from './method'
import type { MockResponse } from './response'

export type ResponseSuggestion = {
  /** The response key, in the kebab-case the example project uses. */
  name: string
  response: MockResponse
}

/**
 * A route param is a whole segment starting with `:`. `/orders/a:b` is a
 * literal path, not a parameterised one — testing for a bare `includes(':')`
 * got that wrong and pushed a `not-found` onto collections.
 */
export function hasPathParam(path: string): boolean {
  return path.split('/').some((segment) => segment.startsWith(':') && segment.length > 1)
}

const message = (body: string): MockResponse['body'] => ({ message: body })

/**
 * `204 No Content` is built without a `body` key rather than with
 * `body: undefined`: the writer serialises the object, and an explicit
 * `undefined` becomes `"body": null` in the mock file — which makes the
 * server send a body on a status that must not have one.
 */
const noContent: MockResponse = { status: 204 }

function family(method: string, parameterised: boolean): ResponseSuggestion[] {
  switch (method) {
    case 'GET':
      return [
        { name: 'ok', response: { status: 200, body: {} } },
        parameterised
          ? { name: 'not-found', response: { status: 404, body: message('Not found') } }
          : { name: 'empty', response: { status: 200, body: [] } },
        { name: 'error', response: { status: 500, body: message('Something went wrong') } },
      ]

    case 'POST':
      return [
        { name: 'created', response: { status: 201, body: {} } },
        {
          name: 'validation-error',
          response: { status: 422, body: message('Some fields are invalid') },
        },
        { name: 'conflict', response: { status: 409, body: message('That already exists') } },
      ]

    case 'PUT':
    case 'PATCH':
      return parameterised
        ? [
            { name: 'ok', response: { status: 200, body: {} } },
            { name: 'not-found', response: { status: 404, body: message('Not found') } },
            { name: 'conflict', response: { status: 409, body: message('That already exists') } },
          ]
        : [
            { name: 'ok', response: { status: 200, body: {} } },
            {
              name: 'validation-error',
              response: { status: 422, body: message('Some fields are invalid') },
            },
          ]

    case 'DELETE':
      return parameterised
        ? [
            { name: 'deleted', response: noContent },
            { name: 'not-found', response: { status: 404, body: message('Not found') } },
          ]
        : [{ name: 'deleted', response: noContent }]

    case 'HEAD':
      return [{ name: 'ok', response: { status: 200 } }]

    case 'OPTIONS':
      return [{ name: 'ok', response: noContent }]

    default:
      // A method laqi routes but has no editorial opinion about. Suggesting
      // a generic 200 here would be noise dressed as help.
      return []
  }
}

/**
 * The responses this endpoint probably wants and does not have yet.
 *
 * The method picks the family; the path shape prunes it. A collection `GET`
 * returns an empty list, never a 404 — offering both to both is how a
 * scaffold becomes noise people learn to dismiss.
 *
 * Names already present are dropped, never replaced: this only ever adds.
 */
export function suggestResponses(input: {
  method: string
  path: string
  existing?: readonly string[]
}): ResponseSuggestion[] {
  const method = input.method.trim().toUpperCase()
  if (!isHttpMethod(method)) return []

  const taken = new Set(input.existing ?? [])
  return family(method, hasPathParam(input.path)).filter(
    (suggestion) => !taken.has(suggestion.name),
  )
}
```

- [ ] **Step 4: Export it from the barrel**

```ts
// packages/schema/src/index.ts — add to the existing list
export * from './scaffold'
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bunx vitest run packages/schema/src/scaffold.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/schema/src/scaffold.ts packages/schema/src/scaffold.test.ts packages/schema/src/index.ts
git commit -m "feat(schema): suggest the response family a method and path shape imply"
```

---

## Task 3: `StatusSelect` — the combobox

**Files:**

- Create: `packages/editor/src/components/StatusSelect.tsx`
- Create: `packages/editor/src/components/StatusSelect.test.tsx`
- Modify: `packages/editor/src/styles.css`

**Interfaces:**

- Consumes: `filterStatusCodes`, `statusClass`, `STATUS_CODES` from `@laqi/schema` (Task 1).
- Produces: `function StatusSelect(props: { id?: string; label: string; value: string; onChange: (value: string) => void }): JSX.Element`

`value` is a **string**, not a number: the field is text the user is mid-way through typing, and forcing it through `Number()` on every keystroke is what makes a status field impossible to clear. The caller converts at submit, exactly as `CreateEndpointRow` does today.

A custom combobox rather than `<select>` or `<datalist>`: `<select>` forbids free text, and `<datalist>` filters on the option value only — typing `not found` would match nothing. The ARIA pattern here is the same one `CommandPalette.tsx` already uses (an input plus a filtered list, ↑/↓/↵/esc), so a user who has learned `⌘K` has learned this.

- [ ] **Step 1: Write the failing test**

```tsx
/** @vitest-environment jsdom */
// packages/editor/src/components/StatusSelect.test.tsx
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StatusSelect } from './StatusSelect'

// This field decides what the mock server actually returns. The one rule it
// must never break is that an unlisted code stays typeable — a mock that
// cannot return 599 is not a mock server.

afterEach(cleanup)

function renderSelect(value = '200') {
  const onChange = vi.fn()
  render(<StatusSelect label="status" value={value} onChange={onChange} />)
  return { onChange, input: screen.getByLabelText('status') }
}

describe('StatusSelect', () => {
  it('shows the current value', () => {
    const { input } = renderSelect('404')
    expect((input as HTMLInputElement).value).toBe('404')
  })

  it('is closed until it is focused', () => {
    renderSelect()
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('opens on focus and lists the catalogue', () => {
    const { input } = renderSelect()
    fireEvent.focus(input)
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /404 Not Found/ })).toBeInTheDocument()
  })

  it('narrows as you type, by name as well as by number', () => {
    const { input } = renderSelect()
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'not found' } })
    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(1)
    expect(options[0]).toHaveTextContent('404 Not Found')
  })

  it('reports every keystroke, so free text survives', () => {
    // 599 is not in the catalogue. It still has to reach the caller.
    const { input, onChange } = renderSelect()
    fireEvent.change(input, { target: { value: '599' } })
    expect(onChange).toHaveBeenCalledWith('599')
  })

  it('says so rather than showing an empty box when nothing matches', () => {
    const { input } = renderSelect()
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '599' } })
    expect(screen.queryByRole('option')).toBeNull()
    expect(screen.getByText(/599 is not a named code/)).toBeInTheDocument()
  })

  it('groups the options by class', () => {
    const { input } = renderSelect()
    fireEvent.focus(input)
    expect(screen.getByText('client error')).toBeInTheDocument()
    expect(screen.getByText('server error')).toBeInTheDocument()
  })

  it('picks the highlighted code on Enter and closes', () => {
    const { input, onChange } = renderSelect()
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '404' } })
    onChange.mockClear()
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith('404')
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('does not swallow Enter when nothing matches, so the form can submit', () => {
    // CreateEndpointRow submits on Enter. If the combobox called
    // preventDefault unconditionally, typing 599 and pressing Enter would
    // do nothing at all and look like a broken form.
    const { input } = renderSelect()
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '599' } })
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    input.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
  })

  it('moves the highlight with the arrow keys', () => {
    const { input, onChange } = renderSelect()
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'not' } })
    onChange.mockClear()
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })
    const [[picked]] = onChange.mock.calls
    expect(picked).not.toBe('304')
  })

  it('closes on Escape without changing the value', () => {
    const { input, onChange } = renderSelect('200')
    fireEvent.focus(input)
    onChange.mockClear()
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('picks a code on click', () => {
    const { input, onChange } = renderSelect()
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '409' } })
    onChange.mockClear()
    fireEvent.mouseDown(screen.getByRole('option', { name: /409 Conflict/ }))
    expect(onChange).toHaveBeenCalledWith('409')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run packages/editor/src/components/StatusSelect.test.tsx`
Expected: FAIL — `Failed to resolve import "./StatusSelect"`.

- [ ] **Step 3: Write the implementation**

```tsx
// packages/editor/src/components/StatusSelect.tsx
import { filterStatusCodes, statusClass, type StatusCode } from '@laqi/schema'
import { useState } from 'react'

/**
 * The status field. A combobox and not a `<select>`, because a mock server
 * has to be able to return a code nobody named — and not a `<datalist>`,
 * because that filters on the option's value only, so "not found" would
 * match nothing.
 *
 * The keys are the command palette's: ↑/↓ move, ↵ picks, esc closes. One
 * search behaviour across the panel, learned once.
 */
export function StatusSelect(props: {
  id?: string
  label: string
  value: string
  onChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)

  const matches = filterStatusCodes(props.value)

  const pick = (code: number) => {
    props.onChange(String(code))
    setOpen(false)
  }

  return (
    <div className="status-select">
      <input
        id={props.id}
        className="create-input create-status"
        role="combobox"
        aria-label={props.label}
        aria-expanded={open}
        aria-autocomplete="list"
        autoComplete="off"
        inputMode="numeric"
        value={props.value}
        onFocus={() => {
          setOpen(true)
          setHighlight(0)
        }}
        // `blur` and not a document listener: the option rows fire on
        // mouseDown, which lands before blur, so the click still registers.
        onBlur={() => setOpen(false)}
        onChange={(event) => {
          props.onChange(event.target.value)
          setOpen(true)
          setHighlight(0)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            setOpen(false)
            // Not stopped: Escape also cancels the create row, and a closed
            // dropdown should not eat the second press.
            return
          }
          if (!open || matches.length === 0) {
            // Nothing to pick. Enter belongs to the form, which is what
            // submits a free-text code like 599.
            return
          }
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            setHighlight((index) => Math.min(index + 1, matches.length - 1))
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault()
            setHighlight((index) => Math.max(index - 1, 0))
          }
          if (event.key === 'Enter') {
            event.preventDefault()
            pick(matches[highlight]!.code)
          }
        }}
      />

      {open ? (
        matches.length === 0 ? (
          <div className="status-empty micro">
            {props.value.trim()} is not a named code — it will be used as typed
          </div>
        ) : (
          <ul className="status-list" role="listbox" aria-label={`${props.label} options`}>
            {groupRows(matches).map((row) =>
              row.kind === 'group' ? (
                <li key={`group-${row.group}`} className="status-group micro" role="presentation">
                  {row.group}
                </li>
              ) : (
                <li
                  key={row.entry.code}
                  role="option"
                  aria-selected={row.index === highlight}
                  className={
                    row.index === highlight ? 'status-option is-highlighted' : 'status-option'
                  }
                  // mouseDown, not click: click fires after blur, by which
                  // point the list is gone and the pick never happens.
                  onMouseDown={(event) => {
                    event.preventDefault()
                    pick(row.entry.code)
                  }}
                >
                  <span className={`chip-status status-${statusClass(row.entry.code)}`}>
                    {row.entry.code}
                  </span>
                  <span className="status-label">{row.entry.label}</span>
                </li>
              ),
            )}
          </ul>
        )
      ) : null}
    </div>
  )
}

type Row =
  | { kind: 'group'; group: string }
  | { kind: 'option'; entry: StatusCode; index: number }

/**
 * Flattens the matches into rows with a group heading inserted whenever the
 * class changes. The option's `index` is its position among OPTIONS, not
 * among rows — the highlight has to skip headings.
 */
function groupRows(matches: readonly StatusCode[]): Row[] {
  const rows: Row[] = []
  let current: string | null = null

  matches.forEach((entry, index) => {
    if (entry.group !== current) {
      current = entry.group
      rows.push({ kind: 'group', group: entry.group })
    }
    rows.push({ kind: 'option', entry, index })
  })

  return rows
}
```

- [ ] **Step 4: Add the styles**

```css
/* packages/editor/src/styles.css — append */
.status-select {
  position: relative;
}
.status-list {
  position: absolute;
  z-index: 20;
  top: calc(100% + 4px);
  left: 0;
  min-width: 15rem;
  max-height: 16rem;
  overflow-y: auto;
  margin: 0;
  padding: 4px;
  list-style: none;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 6px;
}
.status-group {
  padding: 6px 8px 2px;
  color: var(--dim2);
}
.status-option {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  border-radius: 4px;
  cursor: pointer;
}
.status-option.is-highlighted {
  background: var(--hover);
}
.status-label {
  color: var(--fg);
}
.status-empty {
  position: absolute;
  z-index: 20;
  top: calc(100% + 4px);
  left: 0;
  min-width: 15rem;
  padding: 8px;
  color: var(--dim2);
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 6px;
}
```

If `--hover` or `--dim2` is not defined in `packages/tokens/src/tokens.css`, use the nearest token that is — do not add a new hex literal, which the Global Constraints forbid. Check with `grep -n '\-\-hover\|--dim2' packages/tokens/src/tokens.css`.

- [ ] **Step 5: Run test to verify it passes**

Run: `bunx vitest run packages/editor/src/components/StatusSelect.test.tsx`
Expected: PASS, 12 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/editor/src/components/StatusSelect.tsx packages/editor/src/components/StatusSelect.test.tsx packages/editor/src/styles.css
git commit -m "feat(editor): add a status combobox that names every code it offers"
```

---

## Task 4: Wire the combobox into both status fields

**Files:**

- Modify: `packages/editor/src/components/CreateEndpointRow.tsx` (the `aria-label="status"` input)
- Modify: `packages/editor/src/components/CreateEndpointRow.test.tsx`
- Modify: `packages/editor/src/components/EndpointDetail.tsx` (the `id="meta-status"` input)

**Interfaces:**

- Consumes: `StatusSelect` from Task 3.
- Produces: no new exports. `CreateInput` keeps its exact shape (`status: number`) — the conversion stays at submit.

Two fields, both today plain text inputs, and they are the only two places a status is typed.

- [ ] **Step 1: Write the failing test**

```tsx
// packages/editor/src/components/CreateEndpointRow.test.tsx — add to the existing describe
it('offers the named codes and still submits an unlisted one', () => {
  const { onCreate } = renderRow()
  fireEvent.change(screen.getByLabelText('path'), { target: { value: '/orders' } })

  const status = screen.getByLabelText('status')
  fireEvent.focus(status)
  fireEvent.change(status, { target: { value: 'not found' } })
  fireEvent.mouseDown(screen.getByRole('option', { name: /404 Not Found/ }))

  fireEvent.click(screen.getByRole('button', { name: 'Create' }))
  expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ status: 404 }))
})

it('submits a code that is not in the catalogue', () => {
  const { onCreate } = renderRow()
  fireEvent.change(screen.getByLabelText('path'), { target: { value: '/orders' } })
  fireEvent.change(screen.getByLabelText('status'), { target: { value: '599' } })
  fireEvent.click(screen.getByRole('button', { name: 'Create' }))
  expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ status: 599 }))
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run packages/editor/src/components/CreateEndpointRow.test.tsx`
Expected: FAIL — `Unable to find role="option"`; the field is still a plain input.

- [ ] **Step 3: Swap the input in `CreateEndpointRow`**

Replace the `create-status` input inside the `mode === 'blank'` branch:

```tsx
// packages/editor/src/components/CreateEndpointRow.tsx
import { StatusSelect } from './StatusSelect'
// ...
<StatusSelect label="status" value={status} onChange={setStatus} />
```

`status` stays a `string` in state and `Number(status) || 200` at submit — both unchanged. The only edit is the element.

- [ ] **Step 4: Swap the input in `EndpointDetail`**

The detail pane's field is controlled by a number and patches on change, so it converts on the way in and out:

```tsx
// packages/editor/src/components/EndpointDetail.tsx — replace the #meta-status input
<StatusSelect
  id="meta-status"
  label="status"
  value={String(current.status)}
  onChange={(next) => patch(selected, { status: Number(next) || current.status })}
/>
```

Keep the surrounding `.meta-field` div and its `<label htmlFor="meta-status">` exactly as they are — `id` is threaded through `StatusSelect` precisely so that label keeps working.

- [ ] **Step 5: Run the panel suite to verify it passes**

Run: `bunx vitest run packages/editor`
Expected: PASS, including the two new tests and every pre-existing `EndpointDetail` test unchanged.

- [ ] **Step 6: Commit**

```bash
git add packages/editor/src/components/CreateEndpointRow.tsx packages/editor/src/components/CreateEndpointRow.test.tsx packages/editor/src/components/EndpointDetail.tsx
git commit -m "feat(editor): use the status combobox in both places a status is typed"
```

---

## Task 5: The scaffold affordance in the detail pane

**Files:**

- Modify: `packages/editor/src/components/EndpointDetail.tsx`
- Modify: `packages/editor/src/components/EndpointDetail.test.tsx`
- Modify: `packages/editor/src/styles.css`

**Interfaces:**

- Consumes: `suggestResponses` from `@laqi/schema` (Task 2); the existing `draft`/`setDraft` state and `uniqueName` helper in `EndpointDetail`.
- Produces: no new exports.

The affordance sits **beside `+ Add response`**, because that is where someone already goes when they want another response — and it disappears once the family is complete, which is what stops it from becoming furniture. It edits the draft; the existing Save writes the file. No new API call.

- [ ] **Step 1: Write the failing test**

```tsx
// packages/editor/src/components/EndpointDetail.test.tsx — add a describe
describe('the response scaffold', () => {
  it('offers the siblings an item GET is missing, named', () => {
    renderDetail({ id: 'GET /orders/:id', responses: { ok: { status: 200 } } })
    expect(
      screen.getByRole('button', { name: /add not-found, error/ }),
    ).toBeInTheDocument()
  })

  it('adds them to the draft without touching what is there', () => {
    const { onSave } = renderDetail({ id: 'GET /orders/:id', responses: { ok: { status: 200, body: { mine: true } } } })
    fireEvent.click(screen.getByRole('button', { name: /add not-found, error/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    const [, definition] = onSave.mock.calls[0]!
    expect(Object.keys(definition.responses)).toEqual(['ok', 'not-found', 'error'])
    expect(definition.responses.ok.body).toEqual({ mine: true })
    expect(definition.responses['not-found'].status).toBe(404)
  })

  it('does not appear once the family is complete', () => {
    renderDetail({
      id: 'DELETE /orders/:id',
      responses: { deleted: { status: 204 }, 'not-found': { status: 404 } },
    })
    expect(screen.queryByRole('button', { name: /^add / })).toBeNull()
  })

  it('does not appear for a method it has no opinion about', () => {
    renderDetail({ id: 'OPTIONS /orders', responses: { ok: { status: 204 } } })
    expect(screen.queryByRole('button', { name: /^add / })).toBeNull()
  })

  it('leaves the default response alone', () => {
    // The scaffold adds alternatives. Silently repointing `default` at a 404
    // would change what the server serves right now.
    const { onSave } = renderDetail({ id: 'GET /orders/:id', responses: { ok: { status: 200 } } })
    fireEvent.click(screen.getByRole('button', { name: /add not-found, error/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSave.mock.calls[0]![1].default).toBe('ok')
  })
})
```

`renderDetail` is the existing helper in that file — read its signature before writing these and match it; if it does not take an `id`, thread the endpoint fixture through `test-fixtures.ts` the way the surrounding tests do.

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run packages/editor/src/components/EndpointDetail.test.tsx`
Expected: FAIL — `Unable to find role="button" and name /add not-found, error/`.

- [ ] **Step 3: Write the implementation**

Beside the existing `+ Add response` button:

```tsx
// packages/editor/src/components/EndpointDetail.tsx
import { suggestResponses } from '@laqi/schema'
// ...

// The endpoint id is `METHOD /path`; both halves decide the family.
const [method, ...rest] = props.endpoint.id.split(' ')
const missing = suggestResponses({
  method: method ?? '',
  path: rest.join(' '),
  existing: Object.keys(draft.responses),
})

// ... beside the + Add response button:
{missing.length > 0 ? (
  <button
    type="button"
    className="add-response add-response-scaffold"
    // The names are in the label, not a tooltip: this button writes into
    // the user's repository, so what it will do has to be readable before
    // it is pressed, not after.
    onClick={() => {
      setDraft((previous) => ({
        ...previous,
        responses: {
          ...previous.responses,
          ...Object.fromEntries(missing.map((s) => [s.name, s.response])),
        },
        bodies: {
          ...previous.bodies,
          ...Object.fromEntries(
            missing.map((s) => [
              s.name,
              // A 204 has no body key at all; the editor shows an empty
              // string rather than the string "undefined".
              'body' in s.response ? JSON.stringify(s.response.body, null, 2) : '',
            ]),
          ),
        },
      }))
      setSelected(missing[0]!.name)
    }}
  >
    + add {missing.map((s) => s.name).join(', ')}
  </button>
) : null}
```

Match the `draft`/`bodies` shape the file already uses — read the `+ Add response` handler above it and mirror it exactly rather than inventing a second shape.

- [ ] **Step 4: Add the style**

```css
/* packages/editor/src/styles.css — append */
.add-response-scaffold {
  color: var(--dim2);
}
.add-response-scaffold:hover {
  color: var(--mint);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bunx vitest run packages/editor`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/editor/src/components/EndpointDetail.tsx packages/editor/src/components/EndpointDetail.test.tsx packages/editor/src/styles.css
git commit -m "feat(editor): offer the missing response siblings from the detail pane"
```

---

## Task 6: `scaffold_responses`, the MCP tool

**Files:**

- Modify: `packages/mcp/src/server.ts` (register beside `create_endpoint`, around line 137)
- Modify: `packages/mcp/src/stdio.test.ts`

**Interfaces:**

- Consumes: `suggestResponses` from `@laqi/schema` (Task 2); the existing `project.updateEndpoint(id, definition)` and the `reply()` helper in `server.ts`.
- Produces: an MCP tool `scaffold_responses` taking `{ id: string }`.

The point of the tool is that an agent gets the same one call a human gets one click for. Without it, an agent writes the four responses by hand every time and invents four different names for them.

- [ ] **Step 1: Write the failing test**

```ts
// packages/mcp/src/stdio.test.ts — add to the existing suite, matching its `call` helper
it('scaffold_responses adds the family the endpoint is missing', async () => {
  const result = await call('scaffold_responses', { id: 'GET /users/:id' })
  expect(result.isError).toBeFalsy()
  expect(result.text).toContain('not-found')

  const after = await call('list_endpoints', {})
  expect(after.text).toContain('not-found')
}, 30_000)

it('scaffold_responses does not replace a response that already exists', async () => {
  await call('scaffold_responses', { id: 'GET /users/:id' })
  const second = await call('scaffold_responses', { id: 'GET /users/:id' })
  // The second call has nothing left to add and must say so rather than
  // rewriting the bodies the first call wrote.
  expect(second.text).toMatch(/already has/i)
}, 30_000)

it('scaffold_responses reports an unknown endpoint cleanly', async () => {
  const result = await call('scaffold_responses', { id: 'GET /nope' })
  expect(result.isError).toBe(true)
  expect(result.text).not.toContain('FiberFailure')
}, 30_000)
```

Read the fixture project at the top of `stdio.test.ts` first: if it has no `GET /users/:id`, either add one to the fixture or point the test at an endpoint that is there. Do not assert against an endpoint the fixture does not define.

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run packages/mcp/src/stdio.test.ts`
Expected: FAIL — the tool is not registered, so the call returns an unknown-tool error.

- [ ] **Step 3: Write the implementation**

```ts
// packages/mcp/src/server.ts — register after create_endpoint
server.registerTool(
  'scaffold_responses',
  {
    title: 'Scaffold the usual responses',
    description:
      "Add the responses this endpoint probably needs and does not have yet — the happy path plus the standard failures for its method and path shape. A GET on a collection gets an `empty`; a GET on /:id gets a `not-found`; a POST gets `validation-error` and `conflict`. Bodies are placeholders you can edit or regenerate with generate_data. This only ever ADDS: responses that already exist are left exactly as they are, and the endpoint's default does not change.",
    inputSchema: { id: z.string().describe('Endpoint id, e.g. "GET /users/:id"') },
  },
  ({ id }) => {
    const found = project.getEndpoint(id)
    if (!found.ok) return reply(found)

    const [method, ...rest] = id.split(' ')
    const existing = Object.keys(found.value.responses)
    const missing = suggestResponses({ method: method ?? '', path: rest.join(' '), existing })

    if (missing.length === 0) {
      // Not an error: asking twice is a reasonable thing for an agent to do.
      // It just must not silently rewrite the bodies of the first call.
      return reply({
        ok: true,
        value: `${id} already has every response laqi would suggest (${existing.join(', ')}).`,
      })
    }

    return reply(
      project.updateEndpoint(id, {
        description: found.value.description,
        // Unchanged on purpose: the scaffold adds alternatives, it does not
        // change what the server is serving right now.
        default: found.value.default,
        responses: {
          ...found.value.responses,
          ...Object.fromEntries(missing.map((s) => [s.name, s.response])),
        },
      }),
    )
  },
)
```

`project.getEndpoint(id)` may be named differently — read `packages/core`'s `Project` class and use the accessor that already exists, returning the same `ProjectResult` shape `reply()` consumes. If no single-endpoint accessor exists, read from the list the way `update_endpoint`'s neighbours do rather than adding one.

- [ ] **Step 4: Add the import**

```ts
// packages/mcp/src/server.ts — top of file
import { suggestResponses } from '@laqi/schema'
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bunx vitest run packages/mcp`
Expected: PASS, including `tool-descriptions.test.ts` — that suite pins the description prose, so if it asserts a tool count or a list of names, update it in the same commit.

- [ ] **Step 6: Commit**

```bash
git add packages/mcp/src/server.ts packages/mcp/src/stdio.test.ts
git commit -m "feat(mcp): add scaffold_responses so agents get the same one call"
```

---

## Task 7: Documentation, and the roadmap entry that stops lying

**Files:**

- Modify: `apps/site/src/content/docs/docs/panel.md`
- Modify: `apps/site/src/content/docs/docs/ai-agents.md`
- Modify: `apps/documentation/src/content/docs/product/roadmap.md`

**Interfaces:**

- Consumes: everything above.
- Produces: nothing executable.

- [ ] **Step 1: Document the scaffold on the panel page**

Add a short section to `panel.md` under the endpoint-editing material. State the rule plainly, because the rule is the feature:

> **The usual siblings.** Beside **+ Add response**, laqi offers the responses
> the endpoint probably wants and does not have — `not-found` for a
> `GET /orders/:id`, `empty` for a `GET /orders`, `validation-error` and
> `conflict` for a `POST`. It only ever adds: a response you already wrote is
> never replaced, and the default keeps serving what it served. The bodies are
> placeholders — regenerate them from a model with the data generators.

- [ ] **Step 2: Document the MCP tool on the agents page**

Add `scaffold_responses` to the tool list in `ai-agents.md`, in the same format the other tools use there. If that page states a tool count, update the number.

- [ ] **Step 3: Verify the content lint passes**

Run: `bunx vitest run scripts/site`
Expected: PASS — the lint bans `Laqi`/`LAQI` outside code spans.

- [ ] **Step 4: Move both roadmap entries out of "Next"**

In `product/roadmap.md`, delete the **Suggested responses on create** and **Status-code select on create** sections from "Next", add one row to the Shipped table, and update the **Last reviewed** date at the top. Note in the shipped row that the request-log trigger is not included — the roadmap's own text promises it, and leaving that promise in a section marked shipped is exactly the dishonesty the docs rules forbid.

- [ ] **Step 5: Run the full verification**

Run: `bun run verify`
Expected: PASS — lint, format, build, types, and the whole test suite.

- [ ] **Step 6: Commit and open the PR**

```bash
git add apps/site/src/content/docs/docs/panel.md apps/site/src/content/docs/docs/ai-agents.md apps/documentation/src/content/docs/product/roadmap.md
git commit -m "docs: document the status select and the response scaffold"
git push -u origin feat/response-scaffolding
gh pr create --title "feat: response scaffolding and a status select that names its codes" --body "..."
```

The PR body must say, in its own words, that the request-log trigger ("on observing a real 200") is deferred.
