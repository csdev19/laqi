# F6 — Create an endpoint

**Frequency** a few per week · **Surface** inline row at the top of the list

## Steps
1. `+ New endpoint` in the filter row (or `Create first endpoint` in the fresh
   project state).
2. An inline row opens, violet-tinted: method segmented control
   (GET/POST/PUT/PATCH/DELETE, each in its method colour), path, first response
   name, status.
3. `Create` appends the endpoint to `mocks/api.json`, closes the row, and opens
   the new endpoint's detail view with the body ready to edit — creation and
   first edit are one continuous move.
4. `Cancel` discards. Empty path is a no-op.

## Why inline and not a modal
Modals were ruled out for anything that happens while the list matters. The
inline row keeps the existing endpoints visible, which is exactly the context
you need to pick a consistent path and response name.

## Why it lands in the detail view
A new endpoint with one empty response is not useful; the body is the real work,
so the flow ends where that work happens rather than back at the list.
