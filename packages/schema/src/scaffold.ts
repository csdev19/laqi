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
