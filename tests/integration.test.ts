// Integration tests: spawn the real VMP server (src/server/index.ts) as a child process and
// drive it over real TCP sockets, the same way a real node/operator would. This automates the
// manual test scenarios listed in docs/handoff-vmp-project.md rather than duplicating protocol
// logic in-process — if the wire format or dispatch logic breaks, these fail the same way a
// live demo would.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, ChildProcess } from 'node:child_process';
import * as net from 'node:net';
import { encodeRequest } from '../src/protocol/codec';
import { MessageParser } from '../src/protocol/codec';
import { ParsedMessage } from '../src/protocol/types';

const PORT = 45101;
const SECURE_PORT = 45102;
const SECRET = 'integration-test-secret';

/** Wraps a spawned server process: captures its stdout/stderr and can drive its operator REPL. */
class TestServer {
  private child: ChildProcess;
  private log = '';

  constructor(port: number, extraArgs: string[] = []) {
    // `node --import tsx` runs the server as a direct child of node (no shell/npx wrapper in
    // between), so `.kill()` below actually terminates the listening process.
    this.child = spawn(process.execPath, ['--import', 'tsx', 'src/server/index.ts', String(port), ...extraArgs], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child.stdout?.on('data', (d: Buffer) => { this.log += d.toString('utf8'); });
    this.child.stderr?.on('data', (d: Buffer) => { this.log += d.toString('utf8'); });
  }

  waitUntilListening(timeoutMs = 5000): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`server on didn't start in time:\n${this.log}`)), timeoutMs);
      const check = () => {
        if (this.log.includes('listening on port')) {
          clearTimeout(timer);
          resolve();
        } else {
          setTimeout(check, 20);
        }
      };
      check();
    });
  }

  /** Send one line into the server's operator REPL (its stdin), as if an operator typed it. */
  send(line: string) {
    this.child.stdin?.write(line + '\n');
  }

  async waitForLogContains(substring: string, timeoutMs = 3000): Promise<void> {
    const start = Date.now();
    while (!this.log.includes(substring)) {
      if (Date.now() - start > timeoutMs) {
        throw new Error(`timed out waiting for server log to contain ${JSON.stringify(substring)}\n--- log so far ---\n${this.log}`);
      }
      await new Promise((r) => setTimeout(r, 20));
    }
  }

  kill() {
    this.child.kill();
  }
}

/** A minimal VMP client: connects, and lets a test await the next parsed message one at a time. */
class TestClient {
  private socket: net.Socket;
  private parser = new MessageParser();
  private queue: ParsedMessage[] = [];
  private waiters: ((m: ParsedMessage) => void)[] = [];

  private constructor(socket: net.Socket) {
    this.socket = socket;
    socket.on('data', (chunk: Buffer) => {
      for (const msg of this.parser.push(chunk)) {
        const waiter = this.waiters.shift();
        if (waiter) waiter(msg);
        else this.queue.push(msg);
      }
    });
  }

  static connect(port: number): Promise<TestClient> {
    return new Promise((resolve, reject) => {
      const socket = net.connect(port, '127.0.0.1');
      socket.once('connect', () => resolve(new TestClient(socket)));
      socket.once('error', reject);
    });
  }

  send(buf: Buffer) {
    this.socket.write(buf);
  }

  next(timeoutMs = 3000): Promise<ParsedMessage> {
    if (this.queue.length) return Promise.resolve(this.queue.shift()!);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out waiting for a message')), timeoutMs);
      this.waiters.push((m) => {
        clearTimeout(timer);
        resolve(m);
      });
    });
  }

  close() {
    this.socket.destroy();
  }
}

function assertStatus(msg: ParsedMessage, code: number) {
  assert.equal(msg.kind, 'response', `expected a response, got a ${msg.kind}`);
  if (msg.kind === 'response') assert.equal(msg.statusCode, code);
}

describe('VMP integration (real server + real TCP sockets)', () => {
  let server: TestServer;
  let securedServer: TestServer;

  before(async () => {
    server = new TestServer(PORT);
    securedServer = new TestServer(SECURE_PORT, ['--secret', SECRET]);
    await Promise.all([server.waitUntilListening(), securedServer.waitUntilListening()]);
  });

  after(() => {
    server.kill();
    securedServer.kill();
  });

  test('REGISTER happy path -> 201, then PUSH -> 200', async () => {
    const client = await TestClient.connect(PORT);
    client.send(encodeRequest('REGISTER', { 'Node-ID': 'TEMP-90', 'Node-Type': 'TempHumidNode', 'Plot-ID': 'PLOT-90' }));
    assertStatus(await client.next(), 201);

    client.send(encodeRequest('PUSH', { 'Node-ID': 'TEMP-90', Seq: '1' }, { temperature: 30, humidity: 55, timestamp: new Date().toISOString() }));
    assertStatus(await client.next(), 200);

    client.close();
  });

  test('duplicate REGISTER on the same Node-ID -> 409', async () => {
    const a = await TestClient.connect(PORT);
    a.send(encodeRequest('REGISTER', { 'Node-ID': 'TEMP-91', 'Node-Type': 'TempHumidNode', 'Plot-ID': 'PLOT-91' }));
    assertStatus(await a.next(), 201);

    const b = await TestClient.connect(PORT);
    b.send(encodeRequest('REGISTER', { 'Node-ID': 'TEMP-91', 'Node-Type': 'TempHumidNode', 'Plot-ID': 'PLOT-91' }));
    assertStatus(await b.next(), 409);

    a.close();
    b.close();
  });

  test('Node-ID prefix not matching Node-Type -> 400', async () => {
    const client = await TestClient.connect(PORT);
    client.send(encodeRequest('REGISTER', { 'Node-ID': 'SOIL-99', 'Node-Type': 'TempHumidNode', 'Plot-ID': 'PLOT-99' }));
    assertStatus(await client.next(), 400);
    client.close();
  });

  test('PUSH before REGISTER -> 401', async () => {
    const client = await TestClient.connect(PORT);
    client.send(encodeRequest('PUSH', { 'Node-ID': 'GHOST-01' }, {}));
    assertStatus(await client.next(), 401);
    client.close();
  });

  test('STATUS for a never-registered node -> 401 (models a post-restart check)', async () => {
    const client = await TestClient.connect(PORT);
    client.send(encodeRequest('STATUS', { 'Node-ID': 'NEVER-REGISTERED-01' }));
    assertStatus(await client.next(), 401);
    client.close();
  });

  test('STATUS for an already-registered node -> 200 with registered:true', async () => {
    const client = await TestClient.connect(PORT);
    client.send(encodeRequest('REGISTER', { 'Node-ID': 'TEMP-STATUS-01', 'Node-Type': 'TempHumidNode', 'Plot-ID': 'PLOT-STATUS' }));
    assertStatus(await client.next(), 201);

    client.send(encodeRequest('STATUS', { 'Node-ID': 'TEMP-STATUS-01' }));
    const res = await client.next();
    assertStatus(res, 200);
    if (res.kind === 'response') assert.deepEqual(res.body, { registered: true });
    client.close();
  });

  test('ungraceful disconnect: server cleans up so the Node-ID can register again', async () => {
    const first = await TestClient.connect(PORT);
    first.send(encodeRequest('REGISTER', { 'Node-ID': 'LIGHT-92', 'Node-Type': 'LightNode', 'Plot-ID': 'PLOT-92' }));
    assertStatus(await first.next(), 201);
    first.close(); // destroy(), not a graceful UNREGISTER — simulates a killed client process

    await server.waitForLogContains("removed node 'LIGHT-92'");

    const second = await TestClient.connect(PORT);
    second.send(encodeRequest('REGISTER', { 'Node-ID': 'LIGHT-92', 'Node-Type': 'LightNode', 'Plot-ID': 'PLOT-92' }));
    assertStatus(await second.next(), 201); // not 409 — the stale entry was cleaned up
    second.close();
  });

  test('protocol version mismatch -> 400 (ADR 0009)', async () => {
    const client = await TestClient.connect(PORT);
    // Hand-crafted wire bytes: the real client always sends VMP_VERSION correctly, so this
    // bypasses encodeRequest to exercise the version check directly.
    const body = '{}';
    const wire = `REGISTER VMP/9.9\nNode-ID: BAD-VERSION-01\nNode-Type: TempHumidNode\nPlot-ID: PLOT-01\nContent-Length: ${Buffer.byteLength(body)}\n\n${body}`;
    client.send(Buffer.from(wire, 'utf8'));
    assertStatus(await client.next(), 400);
    client.close();
  });

  test('Seq gap after a jump: server logs a warning but still accepts the PUSH (ADR 0006)', async () => {
    const client = await TestClient.connect(PORT);
    client.send(encodeRequest('REGISTER', { 'Node-ID': 'SOIL-93', 'Node-Type': 'SoilNode', 'Plot-ID': 'PLOT-93' }));
    assertStatus(await client.next(), 201);

    const reading = { soil_ph: 6.5, soil_moisture: 30, timestamp: new Date().toISOString() };
    client.send(encodeRequest('PUSH', { 'Node-ID': 'SOIL-93', Seq: '1' }, reading));
    assertStatus(await client.next(), 200);

    client.send(encodeRequest('PUSH', { 'Node-ID': 'SOIL-93', Seq: '5' }, reading)); // jump 2 -> 5
    assertStatus(await client.next(), 200); // detected and logged, not rejected

    await server.waitForLogContains('seq gap');
    client.close();
  });

  describe('Auth-Token (ADR 0008)', () => {
    test('REGISTER with no token against a secured server -> 403', async () => {
      const client = await TestClient.connect(SECURE_PORT);
      client.send(encodeRequest('REGISTER', { 'Node-ID': 'TEMP-94', 'Node-Type': 'TempHumidNode', 'Plot-ID': 'PLOT-94' }));
      assertStatus(await client.next(), 403);
      client.close();
    });

    test('REGISTER with the wrong token -> 403', async () => {
      const client = await TestClient.connect(SECURE_PORT);
      client.send(encodeRequest('REGISTER', { 'Node-ID': 'TEMP-95', 'Node-Type': 'TempHumidNode', 'Plot-ID': 'PLOT-94', 'Auth-Token': 'wrong' }));
      assertStatus(await client.next(), 403);
      client.close();
    });

    test('REGISTER with the correct token -> 201', async () => {
      const client = await TestClient.connect(SECURE_PORT);
      client.send(encodeRequest('REGISTER', { 'Node-ID': 'TEMP-96', 'Node-Type': 'TempHumidNode', 'Plot-ID': 'PLOT-94', 'Auth-Token': SECRET }));
      assertStatus(await client.next(), 201);
      client.close();
    });

    test('an unsecured server (no --secret) ignores Auth-Token entirely', async () => {
      const client = await TestClient.connect(PORT);
      client.send(encodeRequest('REGISTER', { 'Node-ID': 'TEMP-97', 'Node-Type': 'TempHumidNode', 'Plot-ID': 'PLOT-97', 'Auth-Token': 'irrelevant' }));
      assertStatus(await client.next(), 201);
      client.close();
    });
  });

  describe('operator REPL (ADR 0010)', () => {
    test('command <Node-ID> reaches a single node', async () => {
      const client = await TestClient.connect(PORT);
      client.send(encodeRequest('REGISTER', { 'Node-ID': 'LIGHT-98', 'Node-Type': 'LightNode', 'Plot-ID': 'PLOT-98' }));
      assertStatus(await client.next(), 201);

      server.send('command LIGHT-98 REPORT_NOW');
      const command = await client.next();
      assert.equal(command.kind, 'request');
      if (command.kind === 'request') {
        assert.equal(command.method, 'COMMAND');
        assert.equal(command.body.command, 'REPORT_NOW');
      }
      client.close();
    });

    test('command <Plot-ID> broadcasts to every node registered in that plot', async () => {
      const a = await TestClient.connect(PORT);
      a.send(encodeRequest('REGISTER', { 'Node-ID': 'TEMP-99', 'Node-Type': 'TempHumidNode', 'Plot-ID': 'PLOT-99' }));
      assertStatus(await a.next(), 201);

      const b = await TestClient.connect(PORT);
      b.send(encodeRequest('REGISTER', { 'Node-ID': 'SOIL-99', 'Node-Type': 'SoilNode', 'Plot-ID': 'PLOT-99' }));
      assertStatus(await b.next(), 201);

      server.send('command PLOT-99 CALIBRATE 2');
      const [cmdA, cmdB] = await Promise.all([a.next(), b.next()]);

      for (const cmd of [cmdA, cmdB]) {
        assert.equal(cmd.kind, 'request');
        if (cmd.kind === 'request') {
          assert.equal(cmd.method, 'COMMAND');
          assert.equal(cmd.body.command, 'CALIBRATE');
        }
      }
      a.close();
      b.close();
    });

    test('command targeting an unknown Node-ID/Plot-ID logs an error, not a crash', async () => {
      server.send('command NO-SUCH-TARGET SET_INTERVAL 5');
      await server.waitForLogContains("No such registered node or plot: 'NO-SUCH-TARGET'");
    });
  });
});
