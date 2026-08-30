// Entry point: `npx tsx src/client/index.ts --type <TempHumidNode|SoilNode|LightNode>
//   --id <Node-ID> --plot <Plot-ID> [--host localhost] [--port 4000] [--interval 5]
//   [--token <token>]`
//
// Simulates one sensor node. Connects, sends REGISTER, and only starts its push loop after
// receiving `201`. Connection lifecycle (including auto-reconnect, ADR 0007) lives in
// `connection.ts`; reading generation lives in `sensors.ts`; COMMAND handling in `commands.ts`.

import { MessageParser, ParsedMessage, encodeRequest, formatForLog } from '../protocol/codec';
import { NodeType, NODE_TYPE_PREFIX } from '../protocol/types';
import * as connection from './connection';
import { ClientState, generateReading, fieldValue } from './sensors';
import { handleCommand } from './commands';

function getArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  return idx === -1 ? undefined : process.argv[idx + 1];
}

const nodeType = getArg('--type') as NodeType;
const nodeId = getArg('--id');
const plotId = getArg('--plot');
const host = getArg('--host') ?? 'localhost';
const port = Number(getArg('--port') ?? 4000);
const authToken = getArg('--token'); // only needed if the server was started with --secret

if (!nodeType || !nodeId || !plotId || !NODE_TYPE_PREFIX[nodeType]) {
  console.error('Usage: node client.js --type <TempHumidNode|SoilNode|LightNode> --id <Node-ID> --plot <Plot-ID> [--host h] [--port p] [--interval s] [--token t]');
  process.exit(1);
}

const state: ClientState = {
  calibrationOffset: 0,
  threshold: null,
  pushTimer: null,
  intervalSeconds: Number(getArg('--interval') ?? 5),
};

function log(direction: '<-' | '->', msg: ParsedMessage) {
  console.log(`${direction} ${formatForLog(msg)}`);
}

function pushReading() {
  const reading = generateReading(nodeType, state);
  const req = encodeRequest('PUSH', { 'Node-ID': nodeId!, Seq: String(connection.nextSeq()) }, reading);
  connection.send(req);
  log('->', new MessageParser().push(req)[0]);

  if (state.threshold) {
    const v = fieldValue(reading, state.threshold.field);
    if (v !== undefined && v < state.threshold.min) {
      console.log(`  ! ${state.threshold.field}=${v} is below threshold ${state.threshold.min}, will push again next tick`);
    }
  }
}

function startPushing() {
  console.log(`Registered. Pushing every ${state.intervalSeconds}s.`);
  pushReading();
  state.pushTimer = setInterval(pushReading, state.intervalSeconds * 1000);
}

function handleResponse(msg: Extract<ParsedMessage, { kind: 'response' }>) {
  if (msg.statusCode === 201) {
    connection.resetBackoff();
    startPushing();
  } else if (msg.statusCode === 409 || msg.statusCode === 400 || msg.statusCode === 403) {
    console.error(`Registration failed, exiting.`);
    connection.markIntentionalDisconnect();
    process.exit(1);
  }
}

connection.connect({
  host,
  port,
  buildRegister: () => {
    console.log(`Connecting to ${host}:${port} as ${nodeId} (${nodeType}, ${plotId})`);
    const headers: Record<string, string> = {
      'Node-ID': nodeId!,
      'Node-Type': nodeType,
      'Plot-ID': plotId!,
    };
    if (authToken) headers['Auth-Token'] = authToken;
    return encodeRequest('REGISTER', headers);
  },
  onMessage: (msg) => {
    log('<-', msg);
    if (msg.kind === 'response') {
      handleResponse(msg);
    } else if (msg.kind === 'request' && msg.method === 'COMMAND') {
      handleCommand(msg, {
        nodeId: nodeId!,
        state,
        send: connection.send,
        log,
        pushReading,
        markIntentionalDisconnect: connection.markIntentionalDisconnect,
      });
    }
  },
  onClose: () => {
    console.log('Connection closed.');
    if (state.pushTimer) clearInterval(state.pushTimer);
    process.exit(0);
  },
});

process.on('SIGINT', () => {
  console.log('\nCaught SIGINT, sending UNREGISTER...');
  connection.markIntentionalDisconnect();
  const unreg = encodeRequest('UNREGISTER', { 'Node-ID': nodeId! });
  connection.send(unreg);
  log('->', new MessageParser().push(unreg)[0]);
  setTimeout(() => process.exit(0), 300); // fallback in case the server never closes the socket
});
