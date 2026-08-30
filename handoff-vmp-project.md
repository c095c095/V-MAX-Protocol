# Handoff: VMP (V MAX Protocol) — Socket Programming Project 1

## Context

KU course assignment ("Project 1: Socket Programming", see `Project 1_ Socket Programming.md` if carried over) requires three deliverables:
1. A PDF explaining the app's purpose/characteristics, why TCP vs UDP, and the designed application-layer protocol (request/response messages).
2. Source code for client and server, printing every message + status code/phrase sent and received.
3. A demo video (≤15 min) covering protocol design, code walkthrough, and running tests.

The previous session used `/grill-with-docs` (grilling + domain-modeling skills) to interview through every design decision one question at a time, then implemented the result in TypeScript. That process is done — the protocol is fully specified and the code implements it.

## Where design decisions live — read these first, don't re-derive them

- `CONTEXT.md` — glossary: the 3 node types, all 5 VMP methods (+ the 5 COMMAND subtypes), status codes, Node-ID/Plot-ID naming convention, timestamp format.
- `docs/adr/0001-tcp-only-transport.md` — why TCP-only, not TCP+UDP hybrid.
- `docs/adr/0002-text-based-json-protocol.md` — why HTTP-inspired header + JSON body, not binary.
- `docs/adr/0003-nodejs-event-driven-concurrency.md` — concurrency model (originally designed as Python thread-per-connection, revised mid-session when the language changed to Node.js — worth reading both the decision and *why it changed*, it's a useful example of catching a stale assumption).
- `docs/adr/0004-content-length-framing.md` — why `Content-Length` framing, not newline-delimited.
- `docs/adr/0005-nodejs-typescript-runtime.md` — why Node.js+TypeScript over Bun (environment reliability for grading/demo, despite Bun matching the user's usual stack).

## Implementation state

- `src/protocol.ts` — shared module: `encodeRequest`/`encodeResponse`, and `MessageParser`, a buffered TCP framer that correctly handles partial and combined chunks (doesn't assume 1 `data` event = 1 message).
- `src/server.ts` — TCP server handling REGISTER/PUSH/STATUS/UNREGISTER, plus an interactive operator REPL (`list`, `command <NodeID> SET_INTERVAL <s>`, `REPORT_NOW`, `SET_THRESHOLD <field> <min>`, `CALIBRATE <offset>`, `SHUTDOWN`) for demoing the server→node direction live.
- `src/client.ts` — simulates one sensor node via CLI flags (`--type --id --plot --host --port --interval`), generates plausible readings per node type, responds to all 5 COMMAND subtypes, sends UNREGISTER on SIGINT.
- Type-checks clean (`npx tsc --noEmit`, TypeScript 7 / `tsx` runtime — note `moduleResolution` had to be dropped from `tsconfig.json`, not set to `"node"`, due to a TS7 breaking change).

**Tested and passing** (manually, via ad-hoc shell scripts, not committed as automated tests):
- Happy path: REGISTER→201, then PUSH loop→200 repeatedly.
- Duplicate REGISTER on the same Node-ID→409.
- Node-ID prefix not matching Node-Type→400.

**Not yet tested** — these were the agreed demo scenarios and still need a verification pass before being demo-ready:
- Multiple nodes connected concurrently (different types/plots), server handling all without blocking.
- COMMAND round-trip for all 5 subtypes via the server REPL.
- PUSH before REGISTER→401.
- Ungraceful disconnect (kill client process) — server should log and clean up, not crash.
- STATUS→401 after a simulated server restart (i.e. node's old registration no longer exists).

To rerun the happy-path/error checks: start the server (`npx tsx src/server.ts <port>`), then in another terminal run the client (`npx tsx src/client.ts --type TempHumidNode --id TEMP-01 --plot PLOT-01 --port <port> --interval 2`). Both print every message with full status code/phrase per the assignment requirement.

## Remaining work, in order of the assignment's 3 requirements

1. **PDF protocol design doc** — not started. All raw content exists in `CONTEXT.md` + the ADRs; this is mostly assembly into report prose, plus message-sequence diagrams (e.g. REGISTER→201→PUSH×N→COMMAND→200, and each error case).
2. **Source code** — implemented; needs the 5 untested scenarios above verified.
3. **Video (≤15 min)** — not started. Plan was 5 demo cases: (1) happy path (2) multi-client concurrent (3) errors: 409/401/400 (4) ungraceful disconnect (5) STATUS→401 post-restart.

## Suggested skills for next session

- `pdf` — for producing the protocol design PDF deliverable.
- `domain-modeling` — if any protocol detail changes while implementing further, keep `CONTEXT.md`/ADRs updated the same way rather than letting docs drift from code.
- `karpathy-guidelines` — good default for any further code changes (surgical edits, no speculative abstraction).

## Files

Everything is in `vmp-project.zip`: `CONTEXT.md`, `docs/adr/0001..0005`, `src/{protocol,server,client}.ts`, `package.json` (+ lockfile), `tsconfig.json`. Run `npm install` after extracting, then `npx tsc --noEmit` to confirm the environment checks out before continuing.
