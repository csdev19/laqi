---
title: "laqi init — five questions, and every flag an agent needs"
---

# laqi init — five questions, and every flag an agent needs

**Status:** Draft — design agreed from mockups, open questions below unresolved.

There is no `init` today. The CLI has `mcp`, `migrate`, and the default serve
mode. Someone who installs laqi gets a tool that reports `no matching route`
and a folder they have to learn the shape of by reading documentation.

`laqi init` closes that gap: from nothing to a running mock server in about
twenty seconds.

## Two audiences, one command

This is the constraint that shapes everything below. The same command serves:

- **A person**, who wants five questions with sensible defaults and `enter`
  through all of them.
- **An agent**, which cannot answer prompts and must get an identical result
  from flags alone.

Neither is the fallback for the other. **A prompt that has no flag is a bug**,
and so is a flag whose default differs from what the prompt suggests. The test
is mechanical: for every question, `--flag` produces the same files the prompt
does.

Non-interactive is detected, not requested: when stdout is not a TTY, or `--yes`
is passed, every question resolves to its default and nothing blocks. CI and
agents get that for free without knowing to ask.

## The five questions

| #   | Question       | Default                              | Flag                                   |
| --- | -------------- | ------------------------------------ | -------------------------------------- |
| 1   | mocks folder   | `./laqi/`                            | `--dir <path>`                         |
| 2   | start from     | example todo API                     | `--from example\|empty\|openapi\|scan` |
| 3   | port           | 8000, or the first free one above it | `--port <n>`                           |
| 4   | add npm script | **no**                               | `--script[=name]`                      |
| 5   | open the panel | **no**                               | `--open`                               |

Question 2's options:

- **example todo API** — 4 routes, 11 responses. Something to flip immediately.
- **empty file** — just the scaffold.
- **import OpenAPI** — a `.yaml` or `.json` spec. `packages/mcp` already has
  `import_openapi`; this reuses it rather than growing a second importer.
- **scan this project** — read `fetch` calls out of the source and propose
  routes from them. The most valuable option and the least certain; see the
  open questions.

Every question is skippable with `enter`, and the progress indicator (`3/5`)
is there so a person knows the end is near.

## Nothing is written outside the mocks folder

**This is a hard rule, not a default.** `laqi init` runs inside a project that
already exists and belongs to someone else. It writes:

```
laqi/api.json
laqi/scenarios.json
laqi/README.md          (see the agent-doc spec)
```

and nothing else, unless the user explicitly opts in at question 4, which
modifies `package.json` to add one script. That question defaults to **no**
precisely because it is the only one that reaches outside.

A tool that scatters files through a project it did not create loses trust
once, permanently.

If `laqi/` already exists, `init` does not overwrite. It reports what is
there and exits — with `--force` as the deliberate escape hatch.

## Output

`init` renders through the same layer as the rest of the CLI (see
[terminal-output.md](./terminal-output.md)), which is why that work comes
first. It ends with what changed and what to do next:

```
⚡ ready ──────────────────────────────────────────────────────── 18s

+ laqi/api.json          4 routes · 11 responses
+ laqi/scenarios.json    offline · logged-out · empty-state
~ package.json           scripts.mock = "laqi start"

next        npm run mock
then        point your app at http://127.0.0.1:8000
```

`+` for created, `~` for modified. The `~` line appears only when question 4
was answered yes — its presence is the receipt for the one intrusive thing
the command can do.

## Agent path

```bash
laqi init --yes                                  # every default, no prompts
laqi init --yes --from empty --port 8010
laqi init --yes --from openapi --spec ./api.yaml
laqi init --yes --dir ./mocks --script=mock:api
```

`--yes` is the switch an agent reaches for. Everything else is optional
because everything else has a default.

Exit codes follow the shared table in
[terminal-output.md](./terminal-output.md): `5` for a bad flag, `2` if the
target folder is unusable.

## Open questions

1. **`scan this project` is a different order of problem from the other
   three.** Finding `fetch(...)` calls means parsing source in whatever
   framework and dialect the project uses, guessing methods and shapes from
   call sites, and being wrong in ways that are hard to notice. The mockup
   shows `14 fetch calls found in src/` with an unstated confidence.
   **Recommendation: ship `init` with example / empty / openapi, and treat
   scan as its own spec.** The other three are deterministic; scan is a
   heuristic wearing the same UI.

2. **What does "port 8000, or the first free one above it" do to the
   scaffold?** If 8000 is taken at `init` time and the answer becomes 8010,
   that number has to land in the npm script and the "point your app at"
   line — and it will be wrong the next time the machine boots with 8000
   free. Options: always scaffold 8000 and let `start` fail loudly with the
   remedy (consistent with how laqi treats busy ports elsewhere), or bake the
   chosen port into a config file. **Leaning toward the first**: fewer moving
   parts, and it matches the behaviour the port error already teaches.

3. **Does `init` also write `laqi.config.json`?** Today config is optional and
   flags cover everything. Writing one is a fourth file in the project and
   only pays off if `init` has something to record that flags cannot.

4. **`--open` on a machine with no browser** — a no-op with a notice, not a
   failure.

## Testing

The mechanical property is worth an actual test rather than review attention:
**for each of the five questions, the flag path and the prompt path produce
byte-identical files.** That is what stops the two audiences drifting apart,
and it is the kind of thing that rots silently without a test.

Everything `init` writes must load: a scaffold that fails `laqi start` is
worse than no scaffold.
