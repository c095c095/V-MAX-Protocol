# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A KU course assignment ("Project 1: Socket Programming"): an IoT sensor-network simulation using a custom
TCP application-layer protocol called **VMP (V MAX Protocol)**. Three deliverables are required: a protocol
design PDF, working client/server source with full message/status logging, and a demo video. See
`handoff-vmp-project.md` for full deliverable status and what remains.

Three simulated sensor node types (`TempHumidNode`, `SoilNode`, `LightNode`) connect to a central TCP server,
push readings periodically, and can receive commands back from the server over the same connection (hybrid
push/command model).

## Where design decisions live — read these before changing protocol behavior

Don't re-derive protocol rationale; it's already recorded:

- `CONTEXT.md` — glossary of node types, all 5 VMP methods (+ 5 COMMAND subtypes), status codes, Node-ID/Plot-ID
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

If a protocol detail changes, update `CONTEXT.md`/the relevant ADR in the same change — don't let docs drift
from code.

## Commands

```
npm install                              # install deps
npx tsc --noEmit                         # type-check (no test suite exists; this is the correctness gate)
npx tsx src/server/index.ts <port> [--secret <token>]         # run the server (default port 4000)
npx tsx src/client/index.ts --type <TempHumidNode|SoilNode|LightNode> --id <Node-ID> --plot <Plot-ID> \
    [--host localhost] [--port 4000] [--interval 5] [--token <token>]   # run a simulated node
```

`--secret`/`--token` are optional (ADR 0008) — omit both and REGISTER requires no `Auth-Token`, unchanged from
the original demo flow.

`package.json`'s `test` script is a placeholder — testing so far has been manual (start server, connect one or
more clients, observe logged messages/status codes). There is no automated test suite to run or extend unless
you add one.

Note: `tsconfig.json` intentionally omits `moduleResolution` — TypeScript 7 changed its behavior, and setting
it to `"node"` breaks the build. Don't add it back without checking.

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
(`generateReading` switch) for a node type) → `CONTEXT.md` (glossary entry) → an ADR if the design choice needs
justifying.

## Conventions worth preserving

- Status codes/phrases are centralized in `STATUS_PHRASES` (`protocol/types.ts`) — don't hardcode phrase
  strings elsewhere.
- Node-ID prefixes must match `NODE_TYPE_PREFIX` (e.g. `TEMP-01` for `TempHumidNode`) — this is validated on
  `REGISTER` (400 if mismatched) and used elsewhere as the source of truth for the naming convention.
- Timestamps in PUSH bodies are ISO 8601 with the Bangkok `+07:00` offset (see `CONTEXT.md`), not UTC `Z`.
