// apps/cli/src/init/scaffold.ts
//
// Pure builders for the `example` and `empty` starting points. No I/O — the
// writer decides where these land.
import type { EndpointDefinition, Scenarios } from '@laqi/schema'

export type Scaffold = {
  api: Record<string, EndpointDefinition>
  scenarios: Scenarios
}

/**
 * The example scaffold: 4 routes, 11 responses — something to flip
 * immediately. Deliberately smaller than examples/todo-app's 7 routes / 21
 * responses: that one is a demo app to explore, this is a first impression
 * meant to be read in one screen.
 *
 * A paginated list, a create, an auth call, and a by-id read earn the fourth
 * slot by being the shape most frontends hit first. Every route carries a
 * success; the list also carries an empty and an error state, and the auth
 * call carries the slow response — between them, all three of "at minimum a
 * success, an empty or error state, and a slow one somewhere" are covered.
 */
export function exampleScaffold(): Scaffold {
  const token = 'laqi-demo-token-6f4a91c2'
  const user = { id: 1, name: 'Ada Lovelace', email: 'ada@example.com' }

  const api: Record<string, EndpointDefinition> = {
    'POST /auth/login': {
      description: 'Sign in. The token is canned — laqi never verifies anything.',
      default: 'ok',
      responses: {
        ok: { status: 200, body: { token, user } },
        invalid: { status: 401, body: { message: 'Wrong email or password' } },
        slow: { status: 200, delay: 2000, body: { token, user } },
      },
    },
    'GET /todos': {
      description: "A page of todos. laqi always returns this page's canned items.",
      default: 'ok',
      responses: {
        ok: {
          status: 200,
          body: {
            items: [
              { id: 1, title: 'Read the laqi README', done: true },
              { id: 2, title: 'Flip a response from the panel', done: false },
              { id: 3, title: 'Try the command palette', done: false },
            ],
            page: 1,
            perPage: 10,
            total: 3,
            hasMore: false,
          },
        },
        empty: {
          status: 200,
          body: { items: [], page: 1, perPage: 10, total: 0, hasMore: false },
        },
        error: { status: 500, body: { message: 'The todo service is having a bad day' } },
      },
    },
    'POST /todos': {
      description: 'Create a todo.',
      default: 'created',
      responses: {
        created: { status: 201, body: { id: 4, title: 'A brand new todo', done: false } },
        invalid: { status: 422, body: { message: 'A todo needs a title' } },
        error: { status: 500, body: { message: 'Could not save the todo' } },
      },
    },
    'GET /todos/:id': {
      description: 'One todo by id.',
      default: 'ok',
      responses: {
        ok: { status: 200, body: { id: 1, title: 'Read the laqi README', done: true } },
        'not-found': { status: 404, body: { message: 'No todo with that id' } },
      },
    },
  }

  const scenarios: Scenarios = {
    offline: { 'GET /todos': 'error', 'POST /todos': 'error' },
    'logged-out': { 'POST /auth/login': 'invalid' },
    'empty-state': { 'GET /todos': 'empty' },
  }

  return { api, scenarios }
}

/**
 * The empty scaffold. Not a literal `{}`: an endpoint-less api.json makes
 * `laqi` report "nothing to serve" and exit — which fails the spec's own
 * testing rule ("everything init writes must load: a scaffold that fails
 * laqi start is worse than no scaffold"). One placeholder route keeps the
 * scaffold structurally honest and still reads as "start from nothing" —
 * delete the one route and the file is genuinely empty.
 */
export function emptyScaffold(): Scaffold {
  return {
    api: {
      'GET /example': {
        description: 'Replace this with your first real endpoint.',
        default: 'ok',
        responses: {
          ok: { status: 200, body: { message: 'Hello from laqi' } },
        },
      },
    },
    scenarios: {},
  }
}
