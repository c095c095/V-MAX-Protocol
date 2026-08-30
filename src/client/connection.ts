// ADR 0006 (Seq) + ADR 0007 (auto-reconnect): owns the socket lifecycle so the rest of the
// client doesn't need to know whether it's talking to the first connection or the Nth
// reconnect. Callers get a small message-passing surface (`send`, `onMessage`) instead of a
// raw socket reference.

import * as net from 'net';
import { MessageParser } from '../protocol/codec';
import { ParsedMessage } from '../protocol/types';

export interface ConnectOptions {
  host: string;
  port: number;
  /** Builds the REGISTER request to send right after every successful TCP connect. */
  buildRegister: () => Buffer;
  onMessage: (msg: ParsedMessage) => void;
  /** Called only for an intentional disconnect (UNREGISTER already sent) — never on a drop. */
  onClose: () => void;
  /** Called on an unexpected drop, before scheduling the reconnect — stop anything (like the
   *  push loop) that assumes a live connection, so it doesn't keep "sending" into nothing. */
  onDisconnect: () => void;
}

const BASE_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30000;

let socket: net.Socket | null = null;
let parser = new MessageParser();
let intentional = false;
let backoffMs = BASE_BACKOFF_MS;
let seq = 0;
let opts: ConnectOptions;

/** Increment and return the next `Seq` value for a PUSH (ADR 0006). */
export function nextSeq(): number {
  seq += 1;
  return seq;
}

export function send(buf: Buffer) {
  socket?.write(buf);
}

/** Call before sending UNREGISTER (SHUTDOWN command or SIGINT) so `close` won't reconnect. */
export function markIntentionalDisconnect() {
  intentional = true;
}

/** Call once REGISTER succeeds (`201`) so a later drop doesn't inherit a long-grown backoff. */
export function resetBackoff() {
  backoffMs = BASE_BACKOFF_MS;
}

export function connect(options: ConnectOptions) {
  opts = options;
  openSocket();
}

function openSocket() {
  seq = 0; // ADR 0006: Seq resets on every fresh connection attempt, reconnect included
  parser = new MessageParser();
  intentional = false;

  socket = net.connect(opts.port, opts.host, () => {
    const req = opts.buildRegister();
    send(req);
    opts.onMessage(new MessageParser().push(req)[0]);
  });

  socket.on('data', (chunk: Buffer | string) => {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    for (const msg of parser.push(buf)) opts.onMessage(msg);
  });

  socket.on('close', () => {
    if (intentional) {
      opts.onClose();
      return;
    }
    opts.onDisconnect();
    const delay = backoffMs;
    console.log(`Connection lost, reconnecting in ${delay / 1000}s...`);
    backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
    setTimeout(openSocket, delay);
  });

  socket.on('error', (err) => {
    // Don't exit here — `close` always follows `error` on a net.Socket, and that's where
    // the reconnect-vs-exit decision actually happens.
    console.error(`Socket error: ${err.message}`);
  });
}
