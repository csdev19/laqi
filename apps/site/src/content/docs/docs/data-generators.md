---
title: Realistic data and types
description: Generate seeded fake data from a model, and derive types in any supported language from a live response.
---

The panel closes the loop around your data model in both directions:
paste a model and get realistic data, or take a live response and get
its types.

## Model → data

Paste a TypeScript interface — a dirty real-world one is fine:
`extends`, `Pick<...>`, imports from libraries that are not present all
resolve through the real TypeScript compiler, not a hand-rolled parser.
laqi infers a shape from it and generates seeded values that look real,
not `"string"` and `0`:

```ts
interface User {
  id: number
  email: string
  createdAt: string
  priceCents: number
}
```

```json
{ "id": 1, "email": "dell.roberts@example.net", "createdAt": "2026-08-24T09:12:00.000Z", "priceCents": 741.32 }
```

The same seed always produces the same output — pass `seed` to get
byte-identical data across runs, useful for snapshot tests.

### How field names pick a generator

Every `string` and `number`/`integer` field is matched against a table of
naming rules, in order — the first one whose pattern matches the field
name wins. This is what makes `email` fields look like emails and
`createdAt` look like a date, instead of both falling back to a random
word.

**String fields:**

| Field name pattern                                         | Produces                           |
| ---------------------------------------------------------- | ---------------------------------- |
| ends in `_at`/`At`, or contains `date`/`time`              | a recent ISO date                  |
| contains `email`                                           | an email address                   |
| exactly `username`                                         | a username                         |
| exactly `filename`                                         | a filename with a `.txt` extension |
| `name`, `firstName`, `lastName`, `fullName`, `displayName` | a person's full name               |
| contains `phone`                                           | a phone number                     |
| contains `avatar`, `image`, `photo`                        | an image URL                       |
| contains `url`, `link`                                     | a URL                              |
| contains `city`                                            | a city name                        |
| contains `street`, `address`                               | a street address                   |
| contains `country`                                         | a country name                     |
| contains `zip`, `postal`                                   | a zip code                         |
| contains `uuid`, `guid`                                    | a UUID                             |
| contains `description`, `bio`, `summary`                   | a sentence                         |
| contains `title`                                           | three lorem-ipsum words            |
| anything else                                              | two lorem-ipsum words              |

**Number and integer fields:**

| Field name pattern                                | Produces                                              |
| ------------------------------------------------- | ----------------------------------------------------- |
| exactly `id` or `_id`                             | a sequential integer — 1, 2, 3, … per field, per call |
| ends in `_id` or `Id` (e.g. `userId`, `order_id`) | a foreign key, 1-1000                                 |
| contains `price`, `total`, `amount`, `cost`       | a decimal price                                       |
| contains `age`                                    | an integer 18-80                                      |
| contains `count`, `quantity`, `qty`               | an integer 0-100                                      |
| anything else                                     | a random number in range, integer or decimal          |

Field-name matching is word-aware, not a raw substring test — `candidate`
does not match `date` (the letters are buried mid-word), and `userName`
matches the person-name rule before the generic fallback because `name`
is a whole word inside it.

Every other JSON type generates directly from its shape: `boolean`,
`null`, arrays (each item generated independently), objects (each field
generated independently), and tuples (exact length, exact type per
position — unlike the JSON Schema bridge used for type printing below,
data generation never loses positional precision).

## Data → types

Every endpoint's response has a **Copy types** button in the panel, with
a language picker. Types are derived from the live response body on
demand, so they can never go stale against a body you changed by hand.

The same operation works from an existing endpoint or from a pasted
model, and covers 25 languages:

C (cJSON), C++, C#, Crystal, Dart, Elixir, Elm, Flow, Go, Haskell, Java,
JavaScript, JavaScript PropTypes, JSON Schema, Kotlin, Objective-C, PHP,
Pike, Python, Ruby, Rust, Scala 3, Smithy, Swift, TypeScript — plus
TypeScript with Zod or Effect Schema validators built in.

```ts
// TypeScript
interface User {
  id: number
  email: string
}
```

```go
// Go
type User struct {
	ID    int64  `json:"id"`
	Email string `json:"email"`
}
```

Nothing about this is persisted beyond ordinary mock JSON — a pasted
model is never saved, and generated data lands in your `laqi/` files
through the same write path the panel's endpoint editor uses.

## From an AI agent

Both directions are MCP tools — `generate_data` and `get_types` — so an
agent can paste a model from a backend discussion, generate a realistic
body, and hand back typed code in one pass. See
[Using laqi with AI agents](/docs/ai-agents/).
