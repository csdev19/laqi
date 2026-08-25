# F3 — Watch requests arrive

**Frequency** continuous · **Surface** right pane, 426px, never a tab

## Trigger
The developer clicks something in their app and wants to know what the mock did.

## Steps
1. Requests stream in over SSE, newest first, prepending live.
2. Each row: `time · METHOD · path · status · resolved (layer) · ms`.
   `resolved` is the verbatim `X-Laqi-Resolved` value, so the panel can be
   checked against the browser network tab character for character.
3. `Pause` freezes the stream to read a burst (dot goes grey); `Resume` catches
   up. `Clear` empties the pane.
4. Clicking a row opens the endpoint that served it → straight into F1 or F5.

## No-route requests
Red tint, red path, `no matching route`, 404. This is the loudest row type in
the pane because "my mock is not answering" is the most common confusion, and
the cause is almost always a typo'd path rather than a broken mock.

## Empty state
Two lines: `Waiting for requests…` and a sentence naming `localhost:8000`. No
illustration, no vertical centring — the pane stays a list.

## Performance
Client cap 200 entries, keyed by sequence number. Only this pane re-renders on
each event; the endpoint list is memoised on the state map.

## Why beside the list
The loop is trigger → observe → flip → trigger. Putting the log behind a tab
hides the observe half at exactly the moment the flip is decided. The 426px
column costs list width, which the chips absorb by wrapping.
