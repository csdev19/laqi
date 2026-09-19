/**
 * What to say when a caller names a response the endpoint does not have.
 *
 * Three doors reach this failure — a request header, an override written to
 * `state.json`, and the control plane's `PUT /api/state` — and all three used
 * to answer with the name and a list of what is declared. That is accurate
 * and leaves the reader stuck: the list looks like a closed set rather than a
 * snapshot of one file. The usual cause is a response that exists in the
 * panel's draft and has never been written, so the fix is the part worth
 * saying. Keeping the sentence here keeps the three doors from drifting.
 *
 * `declared` is never empty: `EndpointSchema` refuses an endpoint with no
 * responses, so anything loaded has at least one.
 */
export function undeclaredResponseMessage(input: {
  name: string
  id: string
  declared: string[]
}): string {
  const { name, id, declared } = input

  return `${JSON.stringify(name)} is not declared on ${id}. Available: ${declared.join(', ')}. A response has to be saved to the mock file before it can be served — if you just added it in the panel, save the endpoint first.`
}
