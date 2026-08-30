import * as net from 'net';
import * as readline from 'readline';
import {
  MessageParser,
  ParsedMessage,
  ParsedRequest,
  NodeType,
  NODE_TYPE_PREFIX,
  CommandName,
  encodeRequest,
  encodeResponse,
  formatForLog,
} from './protocol';

const PORT = Number(process.argv[2] ?? 4000);

interface RegisteredNode {
  nodeId: string;
  nodeType: NodeType;
  plotId: string;
  socket: net.Socket;
}

// Node-ID -> registration info. This is the server's connection table: it's how we find
// a node's live socket later when an operator wants to send it a COMMAND.
const nodes = new Map<string, RegisteredNode>();

function log(nodeId: string, direction: '<-' | '->', msg: ParsedMessage) {
  console.log(`[${nodeId}] ${direction} ${formatForLog(msg)}`);
}

function handleRegister(socket: net.Socket, req: ParsedRequest) {
  const nodeId = req.headers['Node-ID'];
  const nodeType = req.headers['Node-Type'] as NodeType;
  const plotId = req.headers['Plot-ID'];

  if (!nodeId || !nodeType || !plotId) {
    const res = encodeResponse(400, {}, { message: 'REGISTER requires Node-ID, Node-Type, Plot-ID headers' });
    socket.write(res);
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

  nodes.set(nodeId, { nodeId, nodeType, plotId, socket });
  const res = encodeResponse(201, {}, { message: 'Registered successfully' });
  socket.write(res);
  log(nodeId, '->', parseBackForLog(res));
  console.log(`  registered nodes: [${[...nodes.keys()].join(', ')}]`);
}

function handlePush(socket: net.Socket, req: ParsedRequest) {
  const nodeId = req.headers['Node-ID'];
  const node = nodeId ? nodes.get(nodeId) : undefined;

  if (!node) {
    const res = encodeResponse(401, {}, { message: 'Node is not registered' });
    socket.write(res);
    log(nodeId ?? '?', '->', parseBackForLog(res));
    return;
  }

  console.log(`  [${node.plotId}/${node.nodeId}] sensor reading: ${JSON.stringify(req.body)}`);
  const res = encodeResponse(200, {}, { message: 'Push received successfully' });
  socket.write(res);
  log(nodeId!, '->', parseBackForLog(res));
}

function handleStatus(socket: net.Socket, req: ParsedRequest) {
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

function handleUnregister(socket: net.Socket, req: ParsedRequest) {
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

// The response we just wrote is never parsed off the wire (we authored it), so this
// re-parses our own encoded bytes purely so `log()` has a single formatting code path.
function parseBackForLog(encoded: Buffer): ParsedMessage {
  const parser = new MessageParser();
  return parser.push(encoded)[0];
}

const server = net.createServer((socket) => {
  const parser = new MessageParser();
  console.log(`\n[server] new connection from ${socket.remoteAddress}:${socket.remotePort}`);

  socket.on('data', (chunk: Buffer | string) => {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    for (const msg of parser.push(buf)) {
      if (msg.kind !== 'request') continue; // server only receives requests from nodes
      const nodeId = msg.headers['Node-ID'] ?? '?';
      log(nodeId, '<-', msg);

      switch (msg.method) {
        case 'REGISTER':
          handleRegister(socket, msg);
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

// --- Operator REPL: lets you send COMMAND to any registered node interactively, which is
// how this hybrid protocol demonstrates the server -> node direction during the demo. ---

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: '> ' });

function printHelp() {
  console.log(`
Commands:
  list                                          list registered nodes
  command <Node-ID> SET_INTERVAL <seconds>       change how often the node pushes
  command <Node-ID> REPORT_NOW                   ask the node to push immediately
  command <Node-ID> SET_THRESHOLD <field> <min>  ask the node to push early if field < min
  command <Node-ID> CALIBRATE <offset>           adjust the node's sensor offset
  command <Node-ID> SHUTDOWN                     tell the node to disconnect
  help                                           show this message
`);
}

rl.on('line', (line) => {
  const parts = line.trim().split(/\s+/);
  const cmd = parts[0];

  if (cmd === 'help' || cmd === '') {
    printHelp();
  } else if (cmd === 'list') {
    console.log(`registered nodes: [${[...nodes.keys()].join(', ')}]`);
  } else if (cmd === 'command') {
    const nodeId = parts[1];
    const commandName = parts[2] as CommandName;
    const node = nodeId ? nodes.get(nodeId) : undefined;

    if (!node) {
      console.log(`No such registered node: '${nodeId}'`);
    } else {
      const payload = buildCommandPayload(commandName, parts.slice(3));
      if (payload === null) {
        console.log(`Unknown or malformed COMMAND: ${parts.slice(2).join(' ')}`);
      } else {
        const req = encodeRequest('COMMAND', { 'Node-ID': node.nodeId }, payload);
        node.socket.write(req);
        console.log(`[${node.nodeId}] -> COMMAND ${JSON.stringify(payload)}`);
      }
    }
  } else {
    console.log(`Unknown operator command: '${cmd}'. Type 'help'.`);
  }

  rl.prompt();
});

function buildCommandPayload(name: CommandName, args: string[]): Record<string, unknown> | null {
  switch (name) {
    case 'SET_INTERVAL':
      return args[0] ? { command: name, seconds: Number(args[0]) } : null;
    case 'REPORT_NOW':
      return { command: name };
    case 'SET_THRESHOLD':
      return args[0] && args[1] ? { command: name, field: args[0], min: Number(args[1]) } : null;
    case 'CALIBRATE':
      return args[0] ? { command: name, offset: Number(args[0]) } : null;
    case 'SHUTDOWN':
      return { command: name };
    default:
      return null;
  }
}

rl.prompt();
