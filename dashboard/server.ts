// VMP Dashboard — a demo aid, NOT one of the assignment's graded deliverables.
//
// Spawns the real, unmodified src/server/index.ts and src/client/index.ts as child processes
// (same technique as tests/integration.test.ts) so the protocol behaves exactly as it does from
// the CLI. This file never touches protocol logic — it only orchestrates processes and re-parses
// their existing stdout for display. See docs/CONTEXT.md / docs/adr for the actual protocol.

import * as path from 'path';
import * as http from 'http';
import { spawn, ChildProcess } from 'child_process';
import { randomUUID } from 'crypto';
import express from 'express';
import { Server as SocketIOServer } from 'socket.io';

const DASHBOARD_PORT = Number(process.argv[2] ?? 3000);
const HOST = '127.0.0.1'; // never expose this — it can spawn arbitrary processes
const REPO_ROOT = path.resolve(__dirname, '..');
const MAX_LOG_LINES = 1000;

type ProcessStatus = 'starting' | 'running' | 'stopped' | 'error';

interface ServerInstance {
  id: string;
  port: number;
  secret?: string;
  child: ChildProcess;
  log: string[];
  status: ProcessStatus;
  registeredNodes: Map<string, { nodeType: string; plotId: string }>;
}

interface ClientInstance {
  id: string;
  nodeId: string;
  nodeType: string;
  plotId: string;
  targetHost: string;
  targetPort: number;
  interval: number;
  token?: string;
  child: ChildProcess;
  log: string[];
  status: ProcessStatus;
}

const servers = new Map<string, ServerInstance>();
const clients = new Map<string, ClientInstance>();
let nextSuggestedPort = 4001;

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
const httpServer = http.createServer(app);
const io = new SocketIOServer(httpServer);

function spawnVmp(args: string[]): ChildProcess {
  // A direct child of node (no npx/shell wrapper) so `.kill()` actually terminates it —
  // spawning through npx leaves the real process orphaned (see tests/integration.test.ts).
  return spawn(process.execPath, ['--import', 'tsx', ...args], {
    cwd: REPO_ROOT,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function appendLog(kind: 'server' | 'client', id: string, log: string[], line: string) {
  log.push(line);
  if (log.length > MAX_LOG_LINES) log.shift();
  io.emit('log', { kind, id, line });
}

/** Buffers stdout/stderr chunks into complete lines (chunks don't align with lines). */
function attachLogging(
  child: ChildProcess,
  kind: 'server' | 'client',
  id: string,
  log: string[],
  onLine: (line: string) => void
) {
  let buffer = '';
  const handle = (chunk: Buffer) => {
    buffer += chunk.toString('utf8');
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (line.length === 0) continue;
      appendLog(kind, id, log, line);
      onLine(line);
    }
  };
  child.stdout?.on('data', handle);
  child.stderr?.on('data', handle);
}

// --- Server-side registered-node tracking, parsed from server/handlers.ts's existing log
// output (no changes to that file — just regex over what it already prints). ---
const REGISTERED_LIST_RE = /registered nodes: \[(.*)\]/;
const REGISTER_HEADERS_RE = /<- REGISTER VMP\/[\d.]+ \| (\{.*?\}) \|/;
const REMOVED_NODE_RE = /connection closed, removed node '([^']+)'/;

function handleServerLogLine(instance: ServerInstance, line: string) {
  const listMatch = line.match(REGISTERED_LIST_RE);
  if (listMatch) {
    const ids = new Set(listMatch[1].split(',').map((s) => s.trim()).filter(Boolean));
    for (const knownId of [...instance.registeredNodes.keys()]) {
      if (!ids.has(knownId)) instance.registeredNodes.delete(knownId);
    }
    for (const id of ids) {
      if (!instance.registeredNodes.has(id)) instance.registeredNodes.set(id, { nodeType: '', plotId: '' });
    }
    broadcastServerList();
    return;
  }

  const registerMatch = line.match(REGISTER_HEADERS_RE);
  if (registerMatch) {
    try {
      const headers = JSON.parse(registerMatch[1]);
      if (headers['Node-ID']) {
        instance.registeredNodes.set(headers['Node-ID'], {
          nodeType: headers['Node-Type'] ?? '',
          plotId: headers['Plot-ID'] ?? '',
        });
        broadcastServerList();
      }
    } catch {
      /* malformed/partial line — ignore */
    }
    return;
  }

  const removedMatch = line.match(REMOVED_NODE_RE);
  if (removedMatch) {
    // Covers ungraceful disconnects, which never print a "registered nodes: [...]" line.
    instance.registeredNodes.delete(removedMatch[1]);
    broadcastServerList();
  }
}

function serializeServers() {
  return [...servers.values()].map((s) => ({
    id: s.id,
    port: s.port,
    secured: Boolean(s.secret),
    status: s.status,
    nodes: [...s.registeredNodes.entries()].map(([nodeId, meta]) => ({ nodeId, ...meta })),
  }));
}

function serializeClients() {
  return [...clients.values()].map((c) => ({
    id: c.id,
    nodeId: c.nodeId,
    nodeType: c.nodeType,
    plotId: c.plotId,
    targetHost: c.targetHost,
    targetPort: c.targetPort,
    interval: c.interval,
    hasToken: Boolean(c.token),
    status: c.status,
  }));
}

function broadcastServerList() {
  io.emit('server:list', serializeServers());
}

function broadcastClientList() {
  io.emit('client:list', serializeClients());
}

function createServerInstance(port: number, secret?: string): ServerInstance {
  const args = ['src/server/index.ts', String(port)];
  if (secret) args.push('--secret', secret);
  const child = spawnVmp(args);

  const instance: ServerInstance = {
    id: randomUUID(),
    port,
    secret,
    child,
    log: [],
    status: 'starting',
    registeredNodes: new Map(),
  };
  servers.set(instance.id, instance);

  attachLogging(child, 'server', instance.id, instance.log, (line) => handleServerLogLine(instance, line));
  child.on('spawn', () => {
    instance.status = 'running';
    broadcastServerList();
  });
  child.on('exit', () => {
    instance.status = 'stopped';
    broadcastServerList();
  });
  child.on('error', (err) => {
    instance.status = 'error';
    appendLog('server', instance.id, instance.log, `[dashboard] spawn error: ${err.message}`);
    broadcastServerList();
  });

  return instance;
}

function createClientInstance(opts: {
  nodeType: string;
  nodeId: string;
  plotId: string;
  targetHost: string;
  targetPort: number;
  interval: number;
  token?: string;
}): ClientInstance {
  const args = [
    'src/client/index.ts',
    '--type', opts.nodeType,
    '--id', opts.nodeId,
    '--plot', opts.plotId,
    '--host', opts.targetHost,
    '--port', String(opts.targetPort),
    '--interval', String(opts.interval),
  ];
  if (opts.token) args.push('--token', opts.token);
  const child = spawnVmp(args);

  const instance: ClientInstance = {
    id: randomUUID(),
    nodeId: opts.nodeId,
    nodeType: opts.nodeType,
    plotId: opts.plotId,
    targetHost: opts.targetHost,
    targetPort: opts.targetPort,
    interval: opts.interval,
    token: opts.token,
    child,
    log: [],
    status: 'starting',
  };
  clients.set(instance.id, instance);

  attachLogging(child, 'client', instance.id, instance.log, () => {});
  child.on('spawn', () => {
    instance.status = 'running';
    broadcastClientList();
  });
  child.on('exit', () => {
    instance.status = 'stopped';
    broadcastClientList();
  });
  child.on('error', (err) => {
    instance.status = 'error';
    appendLog('client', instance.id, instance.log, `[dashboard] spawn error: ${err.message}`);
    broadcastClientList();
  });

  return instance;
}

type Ack = (res: { ok: boolean; id?: string; error?: string }) => void;

io.on('connection', (socket) => {
  socket.emit('init', {
    servers: serializeServers(),
    clients: serializeClients(),
    suggestedPort: nextSuggestedPort,
    logs: {
      server: [...servers.values()].flatMap((s) => s.log.map((line) => ({ kind: 'server', id: s.id, line }))),
      client: [...clients.values()].flatMap((c) => c.log.map((line) => ({ kind: 'client', id: c.id, line }))),
    },
  });

  socket.on('server:create', (payload: { port?: number; secret?: string }, ack?: Ack) => {
    try {
      const port = payload.port && Number.isFinite(payload.port) ? payload.port : nextSuggestedPort;
      const instance = createServerInstance(port, payload.secret || undefined);
      if (port >= nextSuggestedPort) nextSuggestedPort = port + 1;
      broadcastServerList();
      ack?.({ ok: true, id: instance.id });
    } catch (err) {
      ack?.({ ok: false, error: (err as Error).message });
    }
  });

  socket.on('server:kill', ({ id }: { id: string }, ack?: Ack) => {
    const instance = servers.get(id);
    if (!instance) return ack?.({ ok: false, error: 'not found' });
    instance.child.kill('SIGKILL');
    ack?.({ ok: true });
  });

  socket.on('server:remove', ({ id }: { id: string }, ack?: Ack) => {
    const instance = servers.get(id);
    if (!instance) return ack?.({ ok: false, error: 'not found' });
    if (instance.status === 'running' || instance.status === 'starting') {
      return ack?.({ ok: false, error: 'kill it first' });
    }
    servers.delete(id);
    broadcastServerList();
    ack?.({ ok: true });
  });

  socket.on(
    'server:command',
    ({ id, target, subtype, args }: { id: string; target: string; subtype: string; args?: string }, ack?: Ack) => {
      const instance = servers.get(id);
      if (!instance) return ack?.({ ok: false, error: 'not found' });
      const line = `command ${target} ${subtype}${args ? ' ' + args : ''}\n`;
      instance.child.stdin?.write(line);
      ack?.({ ok: true });
    }
  );

  socket.on(
    'client:create',
    (
      payload: {
        nodeType: string;
        nodeId: string;
        plotId: string;
        targetHost: string;
        targetPort: number;
        interval?: number;
        token?: string;
      },
      ack?: Ack
    ) => {
      try {
        if (!payload.nodeType || !payload.nodeId || !payload.plotId || !payload.targetHost || !payload.targetPort) {
          return ack?.({ ok: false, error: 'missing required fields' });
        }
        const instance = createClientInstance({
          nodeType: payload.nodeType,
          nodeId: payload.nodeId,
          plotId: payload.plotId,
          targetHost: payload.targetHost,
          targetPort: Number(payload.targetPort),
          interval: Number(payload.interval ?? 5),
          token: payload.token || undefined,
        });
        broadcastClientList();
        ack?.({ ok: true, id: instance.id });
      } catch (err) {
        ack?.({ ok: false, error: (err as Error).message });
      }
    }
  );

  socket.on('client:stop', ({ id }: { id: string }, ack?: Ack) => {
    const instance = clients.get(id);
    if (!instance) return ack?.({ ok: false, error: 'not found' });
    instance.child.kill('SIGINT'); // triggers the client's own UNREGISTER-then-exit path
    ack?.({ ok: true });
  });

  socket.on('client:kill', ({ id }: { id: string }, ack?: Ack) => {
    const instance = clients.get(id);
    if (!instance) return ack?.({ ok: false, error: 'not found' });
    instance.child.kill('SIGKILL'); // ungraceful — demos the server's ECONNRESET cleanup path
    ack?.({ ok: true });
  });

  socket.on('client:remove', ({ id }: { id: string }, ack?: Ack) => {
    const instance = clients.get(id);
    if (!instance) return ack?.({ ok: false, error: 'not found' });
    if (instance.status === 'running' || instance.status === 'starting') {
      return ack?.({ ok: false, error: 'stop it first' });
    }
    clients.delete(id);
    broadcastClientList();
    ack?.({ ok: true });
  });
});

httpServer.listen(DASHBOARD_PORT, HOST, () => {
  console.log(`VMP dashboard listening on http://${HOST}:${DASHBOARD_PORT}`);
});
