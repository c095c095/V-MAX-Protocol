import * as net from 'net';
import { ParsedMessage, ParsedRequest, NodeType, NODE_TYPE_PREFIX } from '../protocol/types';
import { encodeResponse, MessageParser, formatForLog } from '../protocol/codec';
import { nodes } from './connectionTable';
import { isAuthorized } from './auth';

export function log(nodeId: string, direction: '<-' | '->', msg: ParsedMessage) {
  console.log(`[${nodeId}] ${direction} ${formatForLog(msg)}`);
}

// The response we just wrote is never parsed off the wire (we authored it), so this
// re-parses our own encoded bytes purely so `log()` has a single formatting code path.
export function parseBackForLog(encoded: Buffer): ParsedMessage {
  const parser = new MessageParser();
  return parser.push(encoded)[0];
}

export function handleRegister(socket: net.Socket, req: ParsedRequest, authSecret: string | undefined) {
  const nodeId = req.headers['Node-ID'];
  const nodeType = req.headers['Node-Type'] as NodeType;
  const plotId = req.headers['Plot-ID'];

  if (!nodeId || !nodeType || !plotId) {
    const res = encodeResponse(400, {}, { message: 'REGISTER requires Node-ID, Node-Type, Plot-ID headers' });
    socket.write(res);
    return;
  }

  if (!isAuthorized(req.headers, authSecret)) {
    const res = encodeResponse(403, {}, { message: 'REGISTER requires a valid Auth-Token' });
    socket.write(res);
    log(nodeId, '->', parseBackForLog(res));
    return;
  }

  const expectedPrefix = NODE_TYPE_PREFIX[nodeType];
  if (!expectedPrefix || !nodeId.startsWith(expectedPrefix)) {
    const res = encodeResponse(400, {}, { message: `Node-ID must start with '${expectedPrefix}' for Node-Type '${nodeType}'` });
    socket.write(res);
    log(nodeId ?? '?', '->', parseBackForLog(res));
    return;
  }

  if (nodes.has(nodeId)) {
    const res = encodeResponse(409, {}, { message: `Node-ID '${nodeId}' is already registered` });
    socket.write(res);
    log(nodeId, '->', parseBackForLog(res));
    return;
  }

  nodes.set(nodeId, { nodeId, nodeType, plotId, socket, lastSeq: 0 });
  const res = encodeResponse(201, {}, { message: 'Registered successfully' });
  socket.write(res);
  log(nodeId, '->', parseBackForLog(res));
  console.log(`  registered nodes: [${[...nodes.keys()].join(', ')}]`);
}

export function handlePush(socket: net.Socket, req: ParsedRequest) {
  const nodeId = req.headers['Node-ID'];
  const node = nodeId ? nodes.get(nodeId) : undefined;

  if (!node) {
    const res = encodeResponse(401, {}, { message: 'Node is not registered' });
    socket.write(res);
    log(nodeId ?? '?', '->', parseBackForLog(res));
    return;
  }

  // ADR 0006: detect gaps/duplicates across a reconnect. TCP only guarantees order within
  // one connection, so a reconnect (a brand-new connection) has no memory of where the old
  // one left off — this is detection/logging only, not a retransmission layer.
  const seq = Number(req.headers['Seq']);
  if (Number.isFinite(seq)) {
    if (seq > node.lastSeq + 1) {
      console.log(`  ! seq gap on [${node.nodeId}]: expected ${node.lastSeq + 1}, got ${seq} — message(s) likely lost around a reconnect`);
    } else if (seq <= node.lastSeq) {
      console.log(`  ! duplicate/replayed Seq=${seq} on [${node.nodeId}] (lastSeq=${node.lastSeq})`);
    }
    node.lastSeq = Math.max(node.lastSeq, seq);
  }

  console.log(`  [${node.plotId}/${node.nodeId}] sensor reading: ${JSON.stringify(req.body)}`);
  const res = encodeResponse(200, {}, { message: 'Push received successfully' });
  socket.write(res);
  log(nodeId!, '->', parseBackForLog(res));
}

export function handleStatus(socket: net.Socket, req: ParsedRequest) {
  const nodeId = req.headers['Node-ID'];
  const registered = nodeId ? nodes.has(nodeId) : false;

  if (!registered) {
    const res = encodeResponse(401, {}, { message: 'Node is not registered' });
    socket.write(res);
    log(nodeId ?? '?', '->', parseBackForLog(res));
    return;
  }

  const res = encodeResponse(200, {}, { registered: true });
  socket.write(res);
  log(nodeId!, '->', parseBackForLog(res));
}

export function handleUnregister(socket: net.Socket, req: ParsedRequest) {
  const nodeId = req.headers['Node-ID'];
  if (nodeId) {
    nodes.delete(nodeId);
  }
  const res = encodeResponse(200, {}, { message: 'Unregistered successfully' });
  socket.write(res);
  log(nodeId ?? '?', '->', parseBackForLog(res));
  console.log(`  registered nodes: [${[...nodes.keys()].join(', ')}]`);
  socket.end();
}
