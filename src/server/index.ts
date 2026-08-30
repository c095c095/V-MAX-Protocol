// Entry point: `npx tsx src/server/index.ts <port> [--secret <token>]`
//
// A `net.createServer` TCP server. Concurrency is Node's event loop, not manual threads
// (see ADR 0003): each connection gets its own `socket` from `on('connection', ...)`.
// Per-connection state (the `MessageParser`) is created inside the connection callback, so
// don't hoist it to module scope.

import * as net from 'net';
import { VMP_VERSION } from '../protocol/types';
import { MessageParser, encodeResponse } from '../protocol/codec';
import { nodes } from './connectionTable';
import { handleRegister, handlePush, handleStatus, handleUnregister, log, parseBackForLog } from './handlers';
import { startRepl } from './repl';

function getArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  return idx === -1 ? undefined : process.argv[idx + 1];
}

const PORT = Number(process.argv[2] ?? 4000);
// Optional shared-secret auth (ADR 0008): if unset, REGISTER requires no Auth-Token at
// all — fully backward-compatible with the original demo flow.
const AUTH_SECRET = getArg('--secret');

const server = net.createServer((socket) => {
  const parser = new MessageParser();
  console.log(`\n[server] new connection from ${socket.remoteAddress}:${socket.remotePort}`);

  socket.on('data', (chunk: Buffer | string) => {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    for (const msg of parser.push(buf)) {
      if (msg.kind !== 'request') continue; // server only receives requests from nodes
      const nodeId = msg.headers['Node-ID'] ?? '?';
      log(nodeId, '<-', msg);

      // ADR 0009: every message already carries a version token in its start line; reject
      // anything that doesn't match before it reaches a method handler.
      if (msg.version !== VMP_VERSION) {
        const res = encodeResponse(400, {}, { message: `Unsupported protocol version: ${msg.version}` });
        socket.write(res);
        log(nodeId, '->', parseBackForLog(res));
        continue;
      }

      switch (msg.method) {
        case 'REGISTER':
          handleRegister(socket, msg, AUTH_SECRET);
          break;
        case 'PUSH':
          handlePush(socket, msg);
          break;
        case 'STATUS':
          handleStatus(socket, msg);
          break;
        case 'UNREGISTER':
          handleUnregister(socket, msg);
          break;
        default: {
          const res = encodeResponse(400, {}, { message: `Unknown method: ${msg.method}` });
          socket.write(res);
        }
      }
    }
  });

  socket.on('close', () => {
    // Clean up any node entry that was using this socket (covers ungraceful disconnects,
    // i.e. the node process was killed instead of sending UNREGISTER first).
    for (const [id, node] of nodes) {
      if (node.socket === socket) {
        nodes.delete(id);
        console.log(`[server] connection closed, removed node '${id}'`);
      }
    }
  });

  socket.on('error', (err) => {
    console.log(`[server] socket error: ${err.message}`);
  });
});

server.listen(PORT, () => {
  console.log(`VMP server listening on port ${PORT}`);
  console.log(`Type 'help' for operator commands.\n`);
});

startRepl();
