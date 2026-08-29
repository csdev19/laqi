---
title: Flows
---

# Flows

One file per flow: trigger, steps, states and failure paths. Delivered by
Claude Design, **verbatim**.

> **Name correction pending application.** These documents say
> `./mocks/` and `mocks/api.json`. [ADR-0008](/decisions/0008-multifile-and-names/)
> renamed them to **`./laqi/`** and **`laqi/api.json`** (`mocks/` clashes with
> Jest's `__mocks__` convention and with MSW setups). Affects F6, F8 and F9.
> **The ADR governs; these files are the record of what was delivered.**

| #   | Flow                          | Frequency          | File                                      |
| --- | ----------------------------- | ------------------ | ----------------------------------------- |
| F1  | Flip the active response      | dozens/hour        | [01](/design/flows/01-flip-response/)     |
| F2  | See what is active right now  | continuous         | [02](/design/flows/02-scan-state/)        |
| F3  | Watch requests arrive         | continuous         | [03](/design/flows/03-watch-requests/)    |
| F4  | Activate a scenario           | several/day        | [04](/design/flows/04-activate-scenario/) |
| F5  | Edit an endpoint's definition | a few/day          | [05](/design/flows/05-edit-endpoint/)     |
| F6  | Create an endpoint            | a few/week         | [06](/design/flows/06-create-endpoint/)   |
| F7  | Share the mock publicly       | a few/week         | [07](/design/flows/07-share-publicly/)    |
| F8  | Recover from a broken file    | a few/week, urgent | [08](/design/flows/08-broken-file/)       |
| F9  | Start a fresh project         | once               | [09](/design/flows/09-fresh-project/)     |

Frequency is the layout argument: F1–F3 have no navigation, F4 never leaves
the main view, F5–F9 may cost a view change or a band.
