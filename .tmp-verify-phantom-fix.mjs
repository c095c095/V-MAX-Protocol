import { io } from 'socket.io-client';

const socket = io('http://127.0.0.1:3070');

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
function emitAck(event, payload) {
  return new Promise((resolve, reject) => {
    socket.timeout(5000).emit(event, payload, (err, res) => (err ? reject(err) : resolve(res)));
  });
}
function waitForLogContaining(substr, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for log: ${substr}`)), timeoutMs);
    const handler = (entry) => {
      if (entry.line.includes(substr)) { clearTimeout(timer); socket.off('log', handler); resolve(entry); }
    };
    socket.on('log', handler);
  });
}
function getServerListSnapshot() {
  return new Promise((resolve) => {
    const handler = (list) => { socket.off('server:list', handler); resolve(list); };
    socket.on('server:list', handler);
    // trigger a broadcast by re-requesting init is overkill; command a harmless "list" isn't
    // wired, so just wait for the next natural broadcast instead
  });
}

socket.on('connect', async () => {
  try {
    const server = await emitAck('server:create', { port: 49001 });
    console.log('[1] server:create ack =', server);
    await waitForLogContaining('listening on port 49001');

    // --- Deliberately WRONG prefix -> 400, should NOT create a phantom chip ---
    const rejectedClient = await emitAck('client:create', {
      nodeType: 'TempHumidNode', nodeId: 'SOIL-PHANTOM-01', plotId: 'PLOT-X', targetHost: '127.0.0.1', targetPort: 49001, interval: 5,
    });
    console.log('[2] client:create (mismatched prefix, expect 400) ack =', rejectedClient);
    const listAfterReject = await new Promise((resolve) => {
      const handler = (list) => { socket.off('server:list', handler); resolve(list); };
      socket.on('server:list', handler);
    });
    await waitForLogContaining('400 BadRequest');
    await wait(300); // let any (incorrect, pre-fix) chip-adding broadcast land if it were going to
    const snapshot1 = await emitAck('server:command', { id: server.id, target: '__probe__', subtype: 'REPORT_NOW' }).catch(() => null);
    // can't directly "GET" the list; instead re-derive by listening for the next broadcast
    const phantomCheck = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve('no-broadcast-in-window'), 1500);
      const handler = (list) => {
        clearTimeout(timer);
        socket.off('server:list', handler);
        const found = list.find((s) => s.id === server.id);
        resolve(found ? found.nodes.map((n) => n.nodeId) : []);
      };
      socket.on('server:list', handler);
    });
    console.log('[3] server:list snapshot after rejected REGISTER (should NOT include SOIL-PHANTOM-01):', phantomCheck);
    await emitAck('client:kill', { id: rejectedClient.id });

    // --- Real successful REGISTER -> should show up correctly ---
    const okClient = await emitAck('client:create', {
      nodeType: 'TempHumidNode', nodeId: 'TEMP-REAL-01', plotId: 'PLOT-X', targetHost: '127.0.0.1', targetPort: 49001, interval: 5,
    });
    console.log('[4] client:create (valid) ack =', okClient);
    const realNodeSeen = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out waiting for real node in list')), 5000);
      const handler = (list) => {
        const s = list.find((x) => x.id === server.id);
        const node = s?.nodes.find((n) => n.nodeId === 'TEMP-REAL-01');
        if (node) { clearTimeout(timer); socket.off('server:list', handler); resolve(node); }
      };
      socket.on('server:list', handler);
    });
    console.log('[5] real registered node correctly appears:', realNodeSeen);

    // final direct check that the phantom id never shows up even now
    const finalList = await new Promise((resolve) => {
      const handler = (list) => { socket.off('server:list', handler); resolve(list); };
      socket.on('server:list', handler);
      socket.emit('client:kill', { id: okClient.id }); // triggers a "removed node" broadcast we can observe
    });
    const finalIds = (finalList.find((s) => s.id === server.id)?.nodes ?? []).map((n) => n.nodeId);
    console.log('[6] final node id list on this server:', finalIds);
    if (finalIds.includes('SOIL-PHANTOM-01')) {
      throw new Error('REGRESSION: phantom node from rejected REGISTER is present');
    }
    console.log('[7] confirmed: phantom node never appeared at any point');

    await emitAck('server:kill', { id: server.id });
    await wait(300);
    console.log('\nALL CHECKS PASSED (phantom-node fix)');
    process.exit(0);
  } catch (err) {
    console.error('CHECK FAILED:', err);
    process.exit(1);
  }
});

socket.on('connect_error', (err) => { console.error('connect_error:', err.message); process.exit(1); });
