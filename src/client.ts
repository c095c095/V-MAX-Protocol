import * as net from 'net';
import {
  MessageParser,
  ParsedMessage,
  ParsedRequest,
  NodeType,
  NODE_TYPE_PREFIX,
  encodeRequest,
  encodeResponse,
  formatForLog,
} from './protocol';

// --- CLI args: --type TempHumidNode --id TEMP-01 --plot PLOT-01 [--host localhost] [--port 4000] [--interval 5] ---

function getArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  return idx === -1 ? undefined : process.argv[idx + 1];
}

const nodeType = getArg('--type') as NodeType;
const nodeId = getArg('--id');
const plotId = getArg('--plot');
const host = getArg('--host') ?? 'localhost';
const port = Number(getArg('--port') ?? 4000);
let intervalSeconds = Number(getArg('--interval') ?? 5);

if (!nodeType || !nodeId || !plotId || !NODE_TYPE_PREFIX[nodeType]) {
  console.error('Usage: node client.js --type <TempHumidNode|SoilNode|LightNode> --id <Node-ID> --plot <Plot-ID> [--host h] [--port p] [--interval s]');
  process.exit(1);
}

// Mutable node state that COMMAND messages from the server can change at runtime.
let calibrationOffset = 0;
let threshold: { field: string; min: number } | null = null;
let pushTimer: NodeJS.Timeout | null = null;

function log(direction: '<-' | '->', msg: ParsedMessage) {
  console.log(`${direction} ${formatForLog(msg)}`);
}

/** Generates a plausible reading for this node's type, applying calibration offset. */
function generateReading(): Record<string, unknown> {
  const timestamp = new Date().toISOString().replace('Z', '+07:00');
  switch (nodeType) {
    case 'TempHumidNode':
      return {
        temperature: round1(28 + Math.random() * 4 + calibrationOffset),
        humidity: round1(55 + Math.random() * 20),
        timestamp,
      };
    case 'SoilNode':
      return {
        soil_ph: round1(6.5 + Math.random() * 1 + calibrationOffset),
        soil_moisture: round1(15 + Math.random() * 40),
        timestamp,
      };
    case 'LightNode':
      return {
        light_intensity: Math.round(8000 + Math.random() * 12000 + calibrationOffset * 1000),
        timestamp,
      };
  }
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function fieldValue(reading: Record<string, unknown>, field: string): number | undefined {
  const v = reading[field];
  return typeof v === 'number' ? v : undefined;
}

const socket = net.connect(port, host, () => {
  console.log(`Connected to ${host}:${port} as ${nodeId} (${nodeType}, ${plotId})`);
  const req = encodeRequest('REGISTER', {
    'Node-ID': nodeId!,
    'Node-Type': nodeType,
    'Plot-ID': plotId!,
  });
  socket.write(req);
  log('->', new MessageParser().push(req)[0]);
});

const parser = new MessageParser();

socket.on('data', (chunk: Buffer | string) => {
  const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  for (const msg of parser.push(buf)) {
    log('<-', msg);

    if (msg.kind === 'response') {
      handleResponse(msg);
    } else if (msg.kind === 'request' && msg.method === 'COMMAND') {
      handleCommand(msg);
    }
  }
});

function handleResponse(msg: Extract<ParsedMessage, { kind: 'response' }>) {
  if (msg.statusCode === 201) {
    startPushing();
  } else if (msg.statusCode === 409 || msg.statusCode === 400) {
    console.error(`Registration failed, exiting.`);
    socket.end();
    process.exit(1);
  }
}

function pushReading() {
  const reading = generateReading();
  const req = encodeRequest('PUSH', { 'Node-ID': nodeId! }, reading);
  socket.write(req);
  log('->', new MessageParser().push(req)[0]);

  if (threshold) {
    const v = fieldValue(reading, threshold.field);
    if (v !== undefined && v < threshold.min) {
      console.log(`  ! ${threshold.field}=${v} is below threshold ${threshold.min}, will push again next tick`);
    }
  }
}

function startPushing() {
  console.log(`Registered. Pushing every ${intervalSeconds}s.`);
  pushReading();
  pushTimer = setInterval(pushReading, intervalSeconds * 1000);
}

function handleCommand(req: ParsedRequest) {
  const command = req.body.command as string;
  let responseBody: Record<string, unknown> = { message: `Command '${command}' applied` };

  switch (command) {
    case 'SET_INTERVAL': {
      const seconds = Number(req.body.seconds);
      intervalSeconds = seconds;
      if (pushTimer) {
        clearInterval(pushTimer);
        pushTimer = setInterval(pushReading, intervalSeconds * 1000);
      }
      console.log(`  interval changed to ${seconds}s`);
      break;
    }
    case 'REPORT_NOW': {
      const res = encodeResponse(200, {}, responseBody);
      socket.write(res);
      log('->', new MessageParser().push(res)[0]);
      pushReading();
      return; // response already sent above
    }
    case 'SET_THRESHOLD': {
      threshold = { field: String(req.body.field), min: Number(req.body.min) };
      console.log(`  threshold set: push early if ${threshold.field} < ${threshold.min}`);
      break;
    }
    case 'CALIBRATE': {
      calibrationOffset = Number(req.body.offset);
      console.log(`  calibration offset set to ${calibrationOffset}`);
      break;
    }
    case 'SHUTDOWN': {
      const res = encodeResponse(200, {}, { message: 'Shutting down' });
      socket.write(res);
      log('->', new MessageParser().push(res)[0]);
      if (pushTimer) clearInterval(pushTimer);
      const unreg = encodeRequest('UNREGISTER', { 'Node-ID': nodeId! });
      socket.write(unreg);
      log('->', new MessageParser().push(unreg)[0]);
      return;
    }
    default:
      responseBody = { message: `Unknown command: ${command}` };
  }

  const res = encodeResponse(200, {}, responseBody);
  socket.write(res);
  log('->', new MessageParser().push(res)[0]);
}

socket.on('close', () => {
  console.log('Connection closed.');
  if (pushTimer) clearInterval(pushTimer);
  process.exit(0);
});

socket.on('error', (err) => {
  console.error(`Socket error: ${err.message}`);
  process.exit(1);
});

process.on('SIGINT', () => {
  console.log('\nCaught SIGINT, sending UNREGISTER...');
  const unreg = encodeRequest('UNREGISTER', { 'Node-ID': nodeId! });
  socket.write(unreg);
  log('->', new MessageParser().push(unreg)[0]);
  setTimeout(() => process.exit(0), 300);
});
