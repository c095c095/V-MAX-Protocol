# Video Demo Script — VMP (target: ≤15 min)

Record with the dashboard (`npm run dashboard`, http://127.0.0.1:3000) for the live-demo section —
it's already built, no terminal juggling needed. Keep a terminal ready for `npm test` and for
showing source files. Talk while things happen on screen; don't leave dead air during process spawn.

**Before recording**: run `npm test` once already (warms caches, confirms 27/27) so the on-camera
run is fast and confident, not your first attempt.

---

## 1. Protocol design walkthrough — ~3 min

Open `docs/protocol-design.html` (or the printed PDF). Narrate, don't read verbatim:

- What VMP is: hybrid push/command TCP protocol for a simulated farm sensor network, 3 node types
  (§1).
- Why TCP not UDP — the assignment's logging requirement is the deciding reason (§2).
- Message format: HTTP-inspired header + JSON body + `Content-Length` framing — show Figure 3.1
  on screen (§3).
- Point at the methods table and the status-code table (§5–6) — don't read every row, just orient
  the viewer.
- One sentence on the MQTT/CoAP comparison (§12) — "we picked text over binary specifically
  because the assignment requires human-readable logs, not because we didn't know binary exists."

## 2. Code walkthrough — ~3 min

- `src/protocol/codec.ts` — `MessageParser`, mention it handles partial/combined TCP chunks (a
  `data` event ≠ one message).
- `src/server/handlers.ts` — one handler in full (e.g. `handleRegister`), point at the
  `console.log`/`log()` calls that satisfy the logging requirement.
- `src/client/connection.ts` — auto-reconnect + backoff briefly.
- Skip everything else verbally ("the rest follows the same pattern") — don't burn time file-by-file.

## 3. Automated tests — ~1 min

Run `npm test` on camera. While it runs, say what it covers: protocol encode/decode round-tripping,
`MessageParser` chunking edge cases, and a full integration suite against a real spawned server over
real TCP sockets (REGISTER/PUSH/STATUS/UNREGISTER, every 4xx path, `Seq` gap detection, version
validation, Auth-Token, REPL broadcast). Let "27 pass, 0 fail" land on screen before cutting away —
this is your answer to "testing the program in various forms."

## 4. Live demo, via the dashboard — ~7 min

Open http://127.0.0.1:3000. The "Demo tips" box at the top is your own cheat sheet — leave it open.

1. **Happy path** — Create Server (port 4001, no secret) → Create Client (TempHumidNode, `TEMP-01`,
   `PLOT-01`, target the server from the dropdown) → watch REGISTER→201, then PUSH→200 repeating.
2. **400 BadRequest** — Create another client with a **mismatched** type/ID (e.g. Node Type
   `SoilNode` but Node-ID `TEMP-02`) → watch the 400 in its log.
3. **409 DuplicateNode** — Create a client with the *same* Node-ID as one already registered
   (`TEMP-01`) on the same server → watch the 409.
4. **403 Forbidden (Auth-Token)** — Create a second server with a secret (e.g. `farm123`). Create a
   client targeting it with **no token** → 403. Remove/recreate with the correct `--token` value →
   201.
5. **Group addressing (Plot-ID broadcast)** — Create a 2nd client in `PLOT-01` (different type,
   e.g. LightNode `LIGHT-01`). On the server card's command form, target `PLOT-01` with
   `REPORT_NOW` → both node logs show the COMMAND arrive.
6. **Remaining COMMAND subtypes** — same form: `SET_INTERVAL 2` targeting `TEMP-01`, then
   `SET_THRESHOLD temperature 20`, narrating what each does.
7. **STATUS self-check** — just point at any client's log once 3 PUSHes have gone by; the `STATUS`
   line and `200 {registered:true}` appear on their own (ADR 0012), no action needed.
8. **Ungraceful disconnect** — click **Kill** on a client → server log shows `ECONNRESET` /
   `removed node`, no crash.
9. **Auto-reconnect** — click **Kill** on the *server* while a client still targets it → client log
   shows `reconnecting in 1s / 2s / 4s...`. Click **Start** on that same server card → client
   log shows it re-register.
10. **Graceful shutdown** — click **Stop** on a running client → its log shows it receiving
    `SHUTDOWN`, sending `UNREGISTER`, exiting cleanly.

## 5. Closing note — ~30 sec

Say plainly: two things (`Seq` gap/duplicate detection, protocol version validation) can't be
triggered by any real client, including this dashboard — they only fire on hand-crafted malformed
input, which is exactly what `tests/integration.test.ts` does instead. Point back at the "27 pass"
screen from step 3 as where those are actually proven. This is a strength, not a gap: it shows you
know the difference between what a live demo can show and what only a targeted test can.

---

## Timing budget

| Section | Target |
|---|---|
| 1. Protocol design | 3 min |
| 2. Code walkthrough | 3 min |
| 3. `npm test` | 1 min |
| 4. Live demo (10 beats) | 7 min |
| 5. Closing | 0.5 min |
| **Total** | **~14.5 min** |

If running long, cut from step 4 first (merge 2+3, or drop 6) — never cut step 3 (`npm test`) or
step 5 (closing) — those are what make the "no weaknesses" claim credible instead of just asserted.
