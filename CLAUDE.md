# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A KU course assignment ("Project 1: Socket Programming"): an IoT sensor-network simulation using a custom
TCP application-layer protocol called **VMP (V MAX Protocol)**. Three deliverables are required: a protocol
design PDF, working client/server source with full message/status logging, and a demo video. See
`docs/handoff-vmp-project.md` for full deliverable status and what remains.

Three simulated sensor node types (`TempHumidNode`, `SoilNode`, `LightNode`) connect to a central TCP server,
push readings periodically, and can receive commands back from the server over the same connection (hybrid
push/command model).

`dashboard/` is a separate interactive web demo tool (Express + Socket.IO) that spawns real
`src/server/index.ts`/`src/client/index.ts` processes and shows their logs live — it's a demo aid for the
video, **not one of the three graded deliverables**, and never modifies protocol code. See its own section
below.

## Where design decisions live — read these before changing protocol behavior

Don't re-derive protocol rationale; it's already recorded:

- `docs/CONTEXT.md` — glossary of node types, all 5 VMP methods (+ 5 COMMAND subtypes), status codes, Node-ID/Plot-ID
  naming convention, timestamp format.
- `docs/adr/0001-tcp-only-transport.md` — why TCP-only, not TCP+UDP hybrid.
- `docs/adr/0002-text-based-json-protocol.md` — why HTTP-inspired header + JSON body, not binary.
- `docs/adr/0003-nodejs-event-driven-concurrency.md` — concurrency model; originally written for Python
  thread-per-connection, revised for Node's event loop after the runtime changed (ADR 0005) — read this one for
  an example of catching a stale assumption after a stack change.
- `docs/adr/0004-content-length-framing.md` — why `Content-Length` framing, not newline-delimited JSON.
- `docs/adr/0005-nodejs-typescript-runtime.md` — why Node.js+TypeScript over Bun (grading/demo environment
  reliability, despite Bun matching the user's usual stack).
- `docs/adr/0006-sequence-numbers-for-gap-detection.md` — `Seq` header for detecting message gaps/duplicates
  across a reconnect. Implemented in `server/handlers.ts` (`handlePush`) and `client/connection.ts`.
- `docs/adr/0007-client-auto-reconnect.md` — client-side auto-reconnect with exponential backoff on an
  unintentional disconnect. Implemented in `client/connection.ts`.
- `docs/adr/0008-auth-token-authentication.md` — optional shared-secret `Auth-Token` header on REGISTER, and
  why TLS was considered but deferred instead. Implemented in `server/auth.ts` + `server/handlers.ts`.
- `docs/adr/0009-protocol-version-validation.md` — why the already-present `VMP/1.0` version token now gets
  validated instead of ignored. Implemented in `server/index.ts`'s dispatch loop.
- `docs/adr/0010-broadcast-command-to-plot.md` — operator REPL `command <Plot-ID> ...` to fan a COMMAND out to
  every node in a plot. Implemented in `server/repl.ts`.
- `docs/adr/0011-comparison-with-existing-protocols.md` — VMP vs. MQTT/CoAP comparison table and the "จุดเด่น"
  (strengths) summary built from ADRs 0006–0010.

If a protocol detail changes, update `docs/CONTEXT.md`/the relevant ADR in the same change — don't let docs drift
from code.

## Commands

```
npm install                              # install deps
npm test                                  # type-check (pretest) + run the automated test suite
npx tsc --noEmit                         # type-check only (this is npm test's pretest step)
npx tsx src/server/index.ts <port> [--secret <token>]         # run the server (default port 4000)
npx tsx src/client/index.ts --type <TempHumidNode|SoilNode|LightNode> --id <Node-ID> --plot <Plot-ID> \
    [--host localhost] [--port 4000] [--interval 5] [--token <token>]   # run a simulated node
```

`--secret`/`--token` are optional (ADR 0008) — omit both and REGISTER requires no `Auth-Token`, unchanged from
the original demo flow.

## Tests

`npm test` runs `tsc --noEmit` (via `pretest`) then Node's built-in test runner (`tsx --test`, zero extra
dependencies — reuses the `tsx` devDependency already needed to run the app). Node auto-discovers every
`*.test.ts` file under `tests/`, so a new file there is picked up automatically; no config to touch.

- `tests/protocol.test.ts` — unit tests for `src/protocol/*` (encode/decode round-tripping, `MessageParser`
  chunking edge cases: partial chunks, multiple messages in one chunk). Pure functions, no sockets, fast.
- `tests/integration.test.ts` — spawns the real server (`node --import tsx src/server/index.ts <port>`, a
  direct child process so `.kill()` in `after()` actually terminates it — don't spawn through `npx`, which
  wraps in a shell that swallows the kill signal) and drives it over real TCP sockets via a small `TestClient`
  helper (connect, send a `Buffer`, `await next()` for the next parsed message). This is how REGISTER/PUSH/
  STATUS/UNREGISTER, all 4xx paths, `Auth-Token`, `Seq` gap detection, version validation, and the operator
  REPL (including Plot-ID broadcast) get tested — automates what was previously manual background-process
  testing. To add a case: connect a `TestClient`, send an `encodeRequest(...)`, assert on `await client.next()`;
  to test the REPL, use `server.send('command ...')` and read the pushed COMMAND off a connected client, or
  `server.waitForLogContains(...)` for server-side-only effects (e.g. an unknown-target error).

Note: `tsconfig.json` intentionally omits `moduleResolution` — TypeScript 7 changed its behavior, and setting
it to `"node"` breaks the build. Don't add it back without checking.

## Dashboard (demo tool, not a deliverable)

`npm run dashboard` starts a small Express + Socket.IO app (`dashboard/server.ts`, static frontend in
`dashboard/public/`) on `http://127.0.0.1:3000` (binds to localhost only — it can spawn arbitrary child
processes). It lets you create/start/kill/remove multiple VMP server instances (each its own port, optional
`--secret`), create/start/stop/kill/remove simulated client nodes targeting any of them, send COMMANDs to a
Node-ID or Plot-ID from a form (mirrors `server/repl.ts`), and watch every process's log live, parsed and
color-coded by status/method. Start respawns a stopped instance with the same settings (port/secret, or
node/target/interval/token); Remove only works once stopped, and drops it from the list entirely.

It's built entirely by **spawning the real, unmodified `src/server/index.ts` / `src/client/index.ts`** the
same way `tests/integration.test.ts` does (`spawn(process.execPath, ['--import', 'tsx', ...])` — a direct
child of node, not through `npx`, so `.kill()` actually works) and **re-parsing their existing stdout** with
regexes over `formatForLog`'s output — it never imports or modifies protocol code. If you change what
`server/handlers.ts` or `server/repl.ts` print, check `dashboard/server.ts`'s `REGISTERED_LIST_RE` /
`REGISTER_HEADERS_RE` / `REMOVED_NODE_RE` still match; if you change the log format, dashboard breakage is a
signal, not code to keep in sync proactively.

**Registered-node tracking is two-stage on purpose.** `server/index.ts:34` logs the incoming `<- REGISTER ...`
line for every attempt *before* the server decides to accept or reject it (`handlers.ts`'s 400/403/409 paths
all run after that log line). So `REGISTER_HEADERS_RE` matches never write directly into
`registeredNodes` — they only cache into `pendingMetadata` (a candidate, not a fact). An id is only promoted
into `registeredNodes` when `REGISTERED_LIST_RE`'s `registered nodes: [...]` line — the one line the real
server only prints on confirmed success/removal — actually contains it. Getting this backwards (as an earlier
version of this file did) makes a *rejected* REGISTER show up as a connected node chip, which is exactly
wrong for a tool whose only job is showing what's really happening — worth remembering if you touch this code.

**Client Stop vs. Kill — important platform caveat.** Kill is `child.kill('SIGKILL')`, always an unconditional
hard termination — used to demo the server's ungraceful-disconnect cleanup (`ECONNRESET` → node removed).
Stop is deliberately **not** `child.kill('SIGINT')`: on Windows, Node's `child_process.kill()` cannot deliver
a real signal to a child process at all (Windows has no POSIX signals) — every signal name unconditionally
terminates the process, so `'SIGINT'` and `'SIGKILL'` would behave identically and the client's own graceful
`process.on('SIGINT', ...)` handler (which sends `UNREGISTER`) would never run. Instead, Stop finds the
dashboard-managed server this client is currently pointed at (matching on `targetHost`/`targetPort`, loopback
only) and writes `command <Node-ID> SHUTDOWN\n` to *that server's* stdin — the exact same mechanism the
Server panel's command form uses. The client already handles `SHUTDOWN` correctly (`client/commands.ts`):
responds `200`, sends `UNREGISTER`, exits on its own. This is TCP/protocol-level, not OS-signal-level, so it
works identically on every platform. A 2s fallback hard-kills the process if `SHUTDOWN` had no visible effect
(e.g. it was never actually registered); if no managed server can be found for the target at all (an external
server, not one this dashboard spawned), Stop logs a note and falls back to `SIGKILL` directly.

That fallback timer pins the specific `ChildProcess` it was armed for (`const targetChild = instance.child`)
and checks `instance.child === targetChild` before killing, not just `instance.status`. Reason: if `SHUTDOWN`
succeeds quickly and the user clicks Start again within that same 2s window, `instance.child` gets reassigned
to the *new* process while the stale timer is still pending — checking status alone would find it `'running'`
again (true, but of the new process) and kill the wrong one. Confirmed this was a real bug, not
theoretical — reproduced by scripting Stop immediately followed by Start.

**Command args are subtype-aware in the UI.** `server/repl.ts`'s `buildCommandPayload` requires positional
args for `SET_INTERVAL`/`SET_THRESHOLD`/`CALIBRATE` (space-separated in the raw REPL line) but none for
`REPORT_NOW`/`SHUTDOWN`; sending it with no args isn't rejected with a helpful message — the REPL just prints
`Unknown or malformed COMMAND: <subtype>` with no explanation of what was missing. `dashboard/public/app.js`'s
`SUBTYPE_ARGS` table sets the args `<input>`'s placeholder/required/disabled state per selected subtype (on
card creation and on every `change` of the subtype `<select>`) so the browser's native validation blocks an
incomplete submit before it ever reaches the REPL. If you add a 6th COMMAND subtype, update `SUBTYPE_ARGS`
alongside `buildCommandPayload`.

**The "Demo tips / coverage notes" `<details>` block** (`dashboard/public/index.html`, right under the
header) is load-bearing disclosure, not clutter — a `/scrutinize` pass found the dashboard silently implies
full protocol coverage when `Seq` gap detection (ADR 0006) and version validation (ADR 0009) have no path
through it at all (both need hand-crafted wire bytes no spawned client ever sends), and that auto-reconnect
(ADR 0007) is demoable but only if you already know the non-obvious sequence (kill a server, not the client,
then create a new one on the same port). Don't remove this block without keeping that disclosure somewhere.

Not wired into `pretest`/`npm test` (separate `tsc --noEmit` scope from `src/` on purpose) and not one of the
assignment's three deliverables — useful for the demo video, nothing more.

## Architecture

No build step beyond `tsc`/`tsx`, but the code is split into modules under `src/protocol/`, `src/server/`, and
`src/client/` (one concern per file) — it started as three flat files (`protocol.ts`/`server.ts`/`client.ts`)
and was split once ADRs 0006–0010 made those files too long to navigate comfortably. `tsconfig.json`'s
`"include": ["src/**/*.ts"]` already covers the nested layout, no config change needed if you add more files.

**`src/protocol/`** — the wire format, shared by both server and client.
- `types.ts` — constants/types with no encode/decode logic: `VMP_VERSION`, `NodeType`/`NODE_TYPE_PREFIX`,
  `RequestMethod`, `CommandName`, `STATUS_PHRASES`, and the `ParsedRequest`/`ParsedResponse`/`ParsedMessage`
  shapes.
- `codec.ts` — `encodeRequest`/`encodeResponse` serialize VMP messages (HTTP-style start line + headers + blank
  line + `Content-Length`-bounded JSON body, per ADR 0002/0004). `MessageParser` is a stateful, buffered framer
  — feed it raw TCP chunks via `.push(chunk)` and it returns however many complete messages are now available
  (zero, one, or several). This exists because TCP is a byte stream: one `data` event is never guaranteed to
  align with one message. `formatForLog` is the shared log-line formatter both server and client use.

Any change to framing or message shape belongs in `protocol/`, not duplicated in server/client.

**`src/server/`** — a `net.createServer` TCP server, entry point `index.ts`.
- `index.ts` — creates the server, wires each connection's `on('data'/'close'/'error', ...)`, validates the
  `VMP_VERSION` on every request before dispatching to a handler (ADR 0009), and parses `<port>`/`--secret` CLI
  args. Per-connection state (the `MessageParser`) is created inside the connection callback, so don't hoist it
  to module scope. Starts the operator REPL (`repl.ts`) after `server.listen(...)`.
- `connectionTable.ts` — `RegisteredNode` (node metadata + socket reference + `lastSeq`, ADR 0006) and the
  shared `nodes: Map<NodeID, RegisteredNode>` connection table — this is how the server finds a node's live
  socket later to push a `COMMAND`, and how the REPL's Plot-ID broadcast (ADR 0010) finds every node in a plot.
- `auth.ts` — `isAuthorized(headers, secret)`, the ADR 0008 shared-secret check.
- `handlers.ts` — `handleRegister`/`handlePush`/`handleStatus`/`handleUnregister`, plus the `log`/
  `parseBackForLog` logging helpers shared across `index.ts` too.
- `repl.ts` — the interactive operator REPL on stdin (`list`, `command <Node-ID|Plot-ID> <SUBTYPE> [args]`) for
  demoing the server→node direction live — this is how `COMMAND`s actually get sent in a demo, not
  automatically. A Plot-ID target fans the same COMMAND out to every node in that plot (ADR 0010).

**`src/client/`** — simulates one sensor node, entry point `index.ts`.
- `index.ts` — parses CLI flags, owns the mutable `ClientState` object, and wires `connection.ts`'s callbacks
  to `commands.ts`/`sensors.ts`. Only starts its push loop (`startPushing`) after receiving `201`.
- `connection.ts` — owns the socket lifecycle: builds/sends REGISTER on every (re)connect, resets the `Seq`
  counter per connection (ADR 0006), and auto-reconnects with exponential backoff on an unintentional close
  (ADR 0007) via `onDisconnect`/`onClose` callbacks so the caller can stop/resume things like the push timer.
  `markIntentionalDisconnect()` must be called before sending UNREGISTER (SIGINT or `SHUTDOWN`), or the close
  handler will treat it as a drop and try to reconnect.
- `commands.ts` — `handleCommand`, handling all 5 COMMAND subtypes (`SET_INTERVAL`, `REPORT_NOW`,
  `SET_THRESHOLD`, `CALIBRATE`, `SHUTDOWN`) against a passed-in `CommandContext`.
- `sensors.ts` — `generateReading` (plausible per-node-type readings, applies `calibrationOffset`) and the
  `ClientState` shape (`calibrationOffset`/`threshold`/`pushTimer`/`intervalSeconds`) that COMMAND messages
  mutate at runtime.

Both server and client log every message they send/receive via `formatForLog` — this is a hard assignment
requirement, not incidental; don't remove or quiet it.

### Adding a new COMMAND subtype or node type

Touch, in order: `protocol/types.ts` (`CommandName`/`NodeType`/`NODE_TYPE_PREFIX`) → `server/repl.ts`
(`buildCommandPayload` if it's a command) → `client/commands.ts` (`handleCommand` switch, or `client/sensors.ts`
(`generateReading` switch) for a node type) → `docs/CONTEXT.md` (glossary entry) → an ADR if the design choice needs
justifying.

## Conventions worth preserving

- Status codes/phrases are centralized in `STATUS_PHRASES` (`protocol/types.ts`) — don't hardcode phrase
  strings elsewhere.
- Node-ID prefixes must match `NODE_TYPE_PREFIX` (e.g. `TEMP-01` for `TempHumidNode`) — this is validated on
  `REGISTER` (400 if mismatched) and used elsewhere as the source of truth for the naming convention.
- Timestamps in PUSH bodies are ISO 8601 with the Bangkok `+07:00` offset (see `docs/CONTEXT.md`), not UTC `Z`.
