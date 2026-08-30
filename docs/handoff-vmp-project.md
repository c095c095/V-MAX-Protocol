# Handoff: VMP (V MAX Protocol) — Socket Programming Project 1

## Context

KU course assignment ("Project 1: Socket Programming", see `Project 1_ Socket Programming.md` if carried over) requires three deliverables:
1. A PDF explaining the app's purpose/characteristics, why TCP vs UDP, and the designed application-layer protocol (request/response messages).
2. Source code for client and server, printing every message + status code/phrase sent and received.
3. A demo video (≤15 min) covering protocol design, code walkthrough, and running tests.

The previous session used `/grill-with-docs` (grilling + domain-modeling skills) to interview through every design decision one question at a time, then implemented the result in TypeScript. That process is done — the protocol is fully specified and the code implements it.

## Where design decisions live — read these first, don't re-derive them

- `CONTEXT.md` — glossary: the 3 node types, all 5 VMP methods (+ the 5 COMMAND subtypes), status codes, Node-ID/Plot-ID naming convention, timestamp format.
- `adr/0001-tcp-only-transport.md` — why TCP-only, not TCP+UDP hybrid.
- `adr/0002-text-based-json-protocol.md` — why HTTP-inspired header + JSON body, not binary.
- `adr/0003-nodejs-event-driven-concurrency.md` — concurrency model (originally designed as Python thread-per-connection, revised mid-session when the language changed to Node.js — worth reading both the decision and *why it changed*, it's a useful example of catching a stale assumption).
- `adr/0004-content-length-framing.md` — why `Content-Length` framing, not newline-delimited.
- `adr/0005-nodejs-typescript-runtime.md` — why Node.js+TypeScript over Bun (environment reliability for grading/demo, despite Bun matching the user's usual stack).
- `adr/0006-sequence-numbers-for-gap-detection.md` through `adr/0010-broadcast-command-to-plot.md` — 5 new protocol features (Seq gap detection, client auto-reconnect, Auth-Token auth, version validation, Plot-ID broadcast COMMAND), added via a follow-up `/grill-with-docs` session to give VMP genuine differentiators for the Networking course comparison writeup. **Implemented and tested** — see "Implementation state" below.
- `adr/0011-comparison-with-existing-protocols.md` — VMP vs. MQTT/CoAP comparison (8-axis table + balanced trade-off discussion), with a closing "จุดเด่นของ VMP" summary built from ADRs 0006–0010, plus a "future work" section for four further ideas that were deliberately deferred (full session resumption, Message-ID dedupe, batch PUSH, TLS).

## Implementation state

The codebase was split from 3 flat files (`protocol.ts`/`server.ts`/`client.ts`) into modules under
`src/protocol/`, `src/server/`, `src/client/` (one concern per file) once ADRs 0006–0010 made the flat files too
long — see `CLAUDE.md`'s Architecture section for the full per-file breakdown. Entry points are now
`src/server/index.ts` and `src/client/index.ts`.

- `src/protocol/{types,codec}.ts` — wire format, shared by both server and client. `MessageParser` correctly
  handles partial and combined TCP chunks (doesn't assume 1 `data` event = 1 message).
- `src/server/*` — TCP server handling REGISTER/PUSH/STATUS/UNREGISTER, version validation (ADR 0009) and
  optional `--secret` auth (ADR 0008) on every request, `Seq` gap/duplicate detection on PUSH (ADR 0006), and
  an interactive operator REPL (`list`, `command <NodeID|Plot-ID> SET_INTERVAL <s>`, `REPORT_NOW`,
  `SET_THRESHOLD <field> <min>`, `CALIBRATE <offset>`, `SHUTDOWN`) — a Plot-ID target broadcasts to every node
  in that plot (ADR 0010).
- `src/client/*` — simulates one sensor node via CLI flags (`--type --id --plot --host --port --interval
  --token`), generates plausible readings per node type, responds to all 5 COMMAND subtypes, sends UNREGISTER
  on SIGINT, and auto-reconnects with exponential backoff on an unintentional disconnect (ADR 0007), resetting
  its `Seq` counter each time (ADR 0006).
- Type-checks clean (`npx tsc --noEmit`, TypeScript 7 / `tsx` runtime — note `moduleResolution` had to be
  dropped from `tsconfig.json`, not set to `"node"`, due to a TS7 breaking change).

**`npm test` now runs an automated suite** (`tests/protocol.test.ts` + `tests/integration.test.ts`, Node's
built-in test runner via `tsx --test`, zero new dependencies — see `CLAUDE.md`'s Tests section for how it's
structured). 26 tests, all passing:
- Unit: request/response encode-decode round-tripping, `MessageParser` chunking (partial chunks, multiple
  messages in one TCP chunk), `formatForLog`.
- Integration (spawns the real server, drives it over real TCP sockets): REGISTER happy path→201→PUSH→200,
  duplicate REGISTER→409, Node-ID/Node-Type mismatch→400, PUSH before REGISTER→401, STATUS on an unregistered
  node→401, ungraceful disconnect + re-registration, version mismatch→400, `Seq` gap detection+log, `Auth-Token`
  (no/wrong/correct token, and an unsecured server ignoring it), operator REPL `command <Node-ID>` and
  `command <Plot-ID>` broadcast, and an unknown REPL target logging cleanly instead of crashing.

Also manually verified once during implementation (see git history around ADRs 0006–0010's commits) — worth
noting because a real bug was **found and fixed** during that manual pass, before the automated suite existed:
auto-reconnect's push-interval timer wasn't cleared on disconnect, so a reconnect stacked a second timer on top
of the first, causing duplicate/phantom PUSH log lines during an outage. Fixed via a new `onDisconnect` callback
in `client/connection.ts`.

**Still not covered by the automated suite** — worth a manual pass before the video demo, since these need
either 3+ concurrent processes or literally restarting the server:
- Multiple nodes connected concurrently across 3+ different node types/plots at once (integration tests only
  exercise 1–2 at a time).
- COMMAND round-trip for the remaining subtypes via the REPL (`SET_INTERVAL`, `SET_THRESHOLD`, `SHUTDOWN` —
  only `REPORT_NOW` and `CALIBRATE` are exercised in `tests/integration.test.ts`; trivial to extend, same
  pattern as the existing REPL tests).
- STATUS→401 after an *actual* server restart (the automated test approximates this with a STATUS check on a
  Node-ID that was simply never registered, which exercises the same code path but isn't literally a restart).

To rerun manually: start the server (`npx tsx src/server/index.ts <port>`), then in another terminal run the
client (`npx tsx src/client/index.ts --type TempHumidNode --id TEMP-01 --plot PLOT-01 --port <port> --interval
2`). Both print every message with full status code/phrase per the assignment requirement.

## Remaining work, in order of the assignment's 3 requirements

1. **PDF protocol design doc** — not started. All raw content exists in `CONTEXT.md` + the ADRs; this is mostly
   assembly into report prose, plus message-sequence diagrams (e.g. REGISTER→201→PUSH×N→COMMAND→200, and each
   error case). Fold in ADR 0011's MQTT/CoAP comparison table and "จุดเด่นของ VMP" summary as a supplementary
   section at the end (per the user's decision) — it's written to be reused directly, and now describes
   features that actually exist in the shipped code.
2. **Source code** — all 5 new features (ADRs 0006–0010) implemented; `npm test` covers the core protocol
   behavior automatically now (26 tests, see above). The remaining manual-only scenarios (3+ concurrent nodes,
   the rest of the COMMAND subtypes via REPL, a literal server restart) still need a pass before the video demo.
3. **Video (≤15 min)** — not started. Plan was 5 demo cases: (1) happy path (2) multi-client concurrent
   (3) errors: 409/401/400 (4) ungraceful disconnect (5) STATUS→401 post-restart. Consider adding the new
   features as extra demo beats: auth rejection (403), auto-reconnect after killing the server, and the Plot-ID
   broadcast COMMAND — all confirmed working live during this session. The assignment explicitly asks for
   "การทดสอบการรันโปรแกรมที่เขียนในรูปแบบต่างๆ" (testing the program in various forms) — running `npm test` on
   camera and briefly narrating what it covers is a fast, credible way to satisfy that alongside the live demos.

## Suggested skills for next session

- `pdf` — for producing the protocol design PDF deliverable.
- `domain-modeling` — if any protocol detail changes while implementing further, keep `CONTEXT.md`/ADRs updated the same way rather than letting docs drift from code.
- `karpathy-guidelines` — good default for any further code changes (surgical edits, no speculative abstraction).

## Files

`docs/CONTEXT.md`, `docs/adr/0001..0011`, `src/protocol/{types,codec}.ts`, `src/server/{index,connectionTable,auth,handlers,repl}.ts`, `src/client/{index,connection,commands,sensors}.ts`, `tests/{protocol,integration}.test.ts`, `package.json` (+ lockfile), `tsconfig.json`, `.gitignore`. Run `npm install` after extracting, then `npm test` to confirm the environment checks out before continuing.
