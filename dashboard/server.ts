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
  // Metadata parsed from a REGISTER *request* line, which is logged before the server decides
  // to accept or reject it — NOT proof of membership. Only promoted into `registeredNodes` once
  // the authoritative "registered nodes: [...]" line confirms the id is actually present, so a
  // rejected REGISTER (400/403/409) never shows up as a connected node in the UI.
  pendingMetadata: Map<string, { nodeType: string; plotId: string }>;
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
    // The only authoritative source of truth for "who is actually registered" — printed by
    // the real server only after a REGISTER succeeds or an UNREGISTER completes.
    const ids = new Set(listMatch[1].split(',').map((s) => s.trim()).filter(Boolean));
    for (const knownId of [...instance.registeredNodes.keys()]) {
      if (!ids.has(knownId)) instance.registeredNodes.delete(knownId);
    }
    for (const id of ids) {
      if (!instance.registeredNodes.has(id)) {
        const meta = instance.pendingMetadata.get(id) ?? { nodeType: '', plotId: '' };
        instance.registeredNodes.set(id, meta);
      }
    }
    broadcastServerList();
    return;
  }

  const registerMatch = line.match(REGISTER_HEADERS_RE);
  if (registerMatch) {
    // This line is logged for every REGISTER *attempt*, before the server decides to accept
    // or reject it — cache it as a candidate only, don't treat it as membership.
    try {
      const headers = JSON.parse(registerMatch[1]);
      if (headers['Node-ID']) {
        instance.pendingMetadata.set(headers['Node-ID'], {
          nodeType: headers['Node-Type'] ?? '',
          plotId: headers['Plot-ID'] ?? '',
        });
      }
    } catch {
      /* malformed/partial line (or a `}` inside a header value truncated the match) — the
         REGISTERED_LIST_RE branch above already falls back to blank metadata for this id. */
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

/** (Re)spawns the process for an existing ServerInstance — used by both create and Start. */
function spawnServerProcess(instance: ServerInstance) {
  const args = ['src/server/index.ts', String(instance.port)];
  if (instance.secret) args.push('--secret', instance.secret);
  const child = spawnVmp(args);
  instance.child = child;
  instance.status = 'starting';
  instance.registeredNodes.clear(); // a fresh process has no registrations yet
  instance.pendingMetadata.clear();

  attachLogging(child, 'server', instance.id, instance.log, (line) => handleServerLogLine(instance, line));
  child.on('spawn', () => {
    instance.status = 'running';
    broadcastServerList();
  });
  child.on('exit', (code, signal) => {
    // SIGKILL only ever comes from our own Kill/fallback-kill — anything else non-zero is a
    // real crash (uncaught exception, etc.), worth surfacing as distinct from an intended stop.
    const expected = code === 0 || signal === 'SIGKILL';
    instance.status = expected ? 'stopped' : 'error';
    if (!expected) {
      appendLog('server', instance.id, instance.log, `[dashboard] process exited unexpectedly (code=${code}, signal=${signal})`);
    }
    broadcastServerList();
  });
  child.on('error', (err) => {
    instance.status = 'error';
    appendLog('server', instance.id, instance.log, `[dashboard] spawn error: ${err.message}`);
    broadcastServerList();
  });
}

function createServerInstance(port: number, secret?: string): ServerInstance {
  const instance: ServerInstance = {
    id: randomUUID(),
    port,
    secret,
    child: null as unknown as ChildProcess, // set synchronously by spawnServerProcess below
    log: [],
    status: 'starting',
    registeredNodes: new Map(),
    pendingMetadata: new Map(),
  };
  servers.set(instance.id, instance);
  spawnServerProcess(instance);
  return instance;
}

/** (Re)spawns the process for an existing ClientInstance — used by both create and Start. */
function spawnClientProcess(instance: ClientInstance) {
  const args = [
    'src/client/index.ts',
    '--type', instance.nodeType,
    '--id', instance.nodeId,
    '--plot', instance.plotId,
    '--host', instance.targetHost,
    '--port', String(instance.targetPort),
    '--interval', String(instance.interval),
  ];
  if (instance.token) args.push('--token', instance.token);
  const child = spawnVmp(args);
  instance.child = child;
  instance.status = 'starting';

  attachLogging(child, 'client', instance.id, instance.log, () => {});
  child.on('spawn', () => {
    instance.status = 'running';
    broadcastClientList();
  });
  child.on('exit', (code, signal) => {
    // A clean UNREGISTER-then-exit (from Stop/SHUTDOWN) exits with code 0; SIGKILL only ever
    // comes from Kill or Stop's own fallback. Anything else is a real crash.
    const expected = code === 0 || signal === 'SIGKILL';
    instance.status = expected ? 'stopped' : 'error';
    if (!expected) {
      appendLog('client', instance.id, instance.log, `[dashboard] process exited unexpectedly (code=${code}, signal=${signal})`);
    }
    broadcastClientList();
  });
  child.on('error', (err) => {
    instance.status = 'error';
    appendLog('client', instance.id, instance.log, `[dashboard] spawn error: ${err.message}`);
    broadcastClientList();
  });
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
  const instance: ClientInstance = {
    id: randomUUID(),
    nodeId: opts.nodeId,
    nodeType: opts.nodeType,
    plotId: opts.plotId,
    targetHost: opts.targetHost,
    targetPort: opts.targetPort,
    interval: opts.interval,
    token: opts.token,
    child: null as unknown as ChildProcess, // set synchronously by spawnClientProcess below
    log: [],
    status: 'starting',
  };
  clients.set(instance.id, instance);
  spawnClientProcess(instance);
  return instance;
}

/** Finds the dashboard-managed server (if any) that a client is currently pointed at. */
function findManagingServer(instance: ClientInstance): ServerInstance | undefined {
  const isLoopback = ['127.0.0.1', 'localhost', '::1'].includes(instance.targetHost);
  if (!isLoopback) return undefined;
  return [...servers.values()].find((s) => s.port === instance.targetPort && s.status === 'running');
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

  socket.on('server:start', ({ id }: { id: string }, ack?: Ack) => {
    const instance = servers.get(id);
    if (!instance) return ack?.({ ok: false, error: 'not found' });
    if (instance.status === 'running' || instance.status === 'starting') {
      return ack?.({ ok: false, error: 'already running' });
    }
    spawnServerProcess(instance);
    broadcastServerList();
    ack?.({ ok: true });
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

  socket.on('client:start', ({ id }: { id: string }, ack?: Ack) => {
    const instance = clients.get(id);
    if (!instance) return ack?.({ ok: false, error: 'not found' });
    if (instance.status === 'running' || instance.status === 'starting') {
      return ack?.({ ok: false, error: 'already running' });
    }
    spawnClientProcess(instance);
    broadcastClientList();
    ack?.({ ok: true });
  });

  socket.on('client:stop', ({ id }: { id: string }, ack?: Ack) => {
    const instance = clients.get(id);
    if (!instance) return ack?.({ ok: false, error: 'not found' });

    // Graceful stop is routed through the protocol itself (a SHUTDOWN COMMAND, same as the
    // Server panel's command form) rather than an OS signal: on Windows, node's
    // child_process.kill('SIGINT'/'SIGTERM') can't actually deliver a signal to a Node child
    // at all (Windows has no POSIX signals) — it just force-terminates, identical to SIGKILL.
    // SHUTDOWN is TCP-level, so it works the same on every platform.
    const managingServer = findManagingServer(instance);
    if (managingServer) {
      const targetChild = instance.child; // pin the exact process this Stop applies to
      managingServer.child.stdin?.write(`command ${instance.nodeId} SHUTDOWN\n`);
      // Fallback in case SHUTDOWN had no effect (e.g. the client never got past REGISTER, or
      // is mid-reconnect and not currently connected to this server at all). Must check
      // `instance.child === targetChild`, not just `instance.status` — if this same client was
      // already stopped and Start respawned it before this timer fires, `instance.child` now
      // points at a brand-new, unrelated process; killing by `instance.child` alone would kill
      // that new process instead of correctly no-op'ing on this stale fallback.
      setTimeout(() => {
        if (instance.child === targetChild && (instance.status === 'running' || instance.status === 'starting')) {
          targetChild.kill('SIGKILL');
        }
      }, 2000);
    } else {
      appendLog(
        'client',
        id,
        instance.log,
        "[dashboard] no dashboard-managed server found for this client's target — using a hard kill instead of a graceful SHUTDOWN"
      );
      instance.child.kill('SIGKILL');
    }
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
