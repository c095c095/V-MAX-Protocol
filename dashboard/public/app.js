// VMP Dashboard frontend — plain JS, no build step, no framework. Talks to dashboard/server.ts
// over Socket.IO (served automatically at /socket.io/socket.io.js).

const socket = io();

const serverListEl = document.getElementById('server-list');
const clientListEl = document.getElementById('client-list');
const serverPortInput = document.getElementById('server-port');
const serverSecretInput = document.getElementById('server-secret');
const targetServerSelect = document.getElementById('client-target-server');
const clientHostInput = document.getElementById('client-host');
const clientPortInput = document.getElementById('client-port');
const clientIdInput = document.getElementById('client-id');
const clientTokenInput = document.getElementById('client-token');

const serverCards = new Map(); // id -> { el, titleEl, actionsEl, nodesEl, logEl, formEl }
const clientCards = new Map(); // id -> { el, titleEl, actionsEl, logEl }
let latestServers = [];
let suggestedPort = 4001;

// ---- log-line classification (re-parses the exact text formatForLog already produces) ----
function classifyLine(line) {
  const respMatch = line.match(/VMP\/[\d.]+ (\d{3}) \w+/);
  if (respMatch) {
    return Number(respMatch[1]) < 300 ? 'ok' : 'err';
  }
  const reqMatch = line.match(/\b(REGISTER|PUSH|COMMAND|STATUS|UNREGISTER)\b VMP\/[\d.]+/);
  if (reqMatch) return `method-${reqMatch[1]}`;
  if (/-> COMMAND /.test(line)) return 'method-COMMAND';
  if (/seq gap|duplicate\/replayed/i.test(line)) return 'warn';
  if (/reconnecting|Connection lost/i.test(line)) return 'warn';
  if (/removed node|socket error|ECONNRESET|Forbidden|spawn error/i.test(line)) return 'err';
  return 'dim';
}

function appendLogLine(container, line) {
  const div = document.createElement('div');
  div.className = `log-line ${classifyLine(line)}`;
  div.textContent = line;
  container.appendChild(div);
  while (container.childElementCount > 1000) container.removeChild(container.firstChild);
  const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 40;
  if (nearBottom) container.scrollTop = container.scrollHeight;
}

// COMMAND args, per subtype — mirrors server/repl.ts's buildCommandPayload exactly (which args
// are required, in what order, space-separated). REPORT_NOW/SHUTDOWN take none; sending SET_
// THRESHOLD or CALIBRATE with an empty args field silently gets rejected server-side as
// "Unknown or malformed COMMAND" with no explanation, so the UI enforces it before that happens.
const SUBTYPE_ARGS = {
  SET_INTERVAL: { placeholder: 'seconds, e.g. 10', required: true },
  REPORT_NOW: { placeholder: '(no args needed)', required: false },
  SET_THRESHOLD: { placeholder: 'field min, e.g. temperature 20', required: true },
  CALIBRATE: { placeholder: 'offset, e.g. 2', required: true },
  SHUTDOWN: { placeholder: '(no args needed)', required: false },
};

function applySubtypeArgHints(form) {
  const subtypeEl = form.elements.subtype;
  const argsEl = form.elements.args;
  const spec = SUBTYPE_ARGS[subtypeEl.value] ?? { placeholder: '', required: false };
  argsEl.placeholder = spec.placeholder;
  argsEl.required = spec.required;
  argsEl.disabled = !spec.required && spec.placeholder === '(no args needed)';
  if (argsEl.disabled) argsEl.value = '';
}

// ---- server cards ----
function ensureServerCard(id) {
  let card = serverCards.get(id);
  if (!card) {
    const el = document.createElement('div');
    el.className = 'card';
    el.innerHTML = `
      <div class="card-header">
        <span class="card-title"></span>
        <div class="card-actions"></div>
      </div>
      <div class="node-chips"></div>
      <form class="command-form">
        <input name="targetId" placeholder="Node-ID or Plot-ID" required />
        <select name="subtype">
          <option value="SET_INTERVAL">SET_INTERVAL</option>
          <option value="REPORT_NOW">REPORT_NOW</option>
          <option value="SET_THRESHOLD">SET_THRESHOLD</option>
          <option value="CALIBRATE">CALIBRATE</option>
          <option value="SHUTDOWN">SHUTDOWN</option>
        </select>
        <input name="args" placeholder="args, e.g. 10  or  temperature 20" />
        <button type="submit">Send</button>
      </form>
      <div class="log-panel"></div>
    `;
    serverListEl.appendChild(el);
    card = {
      el,
      titleEl: el.querySelector('.card-title'),
      actionsEl: el.querySelector('.card-actions'),
      nodesEl: el.querySelector('.node-chips'),
      logEl: el.querySelector('.log-panel'),
      formEl: el.querySelector('.command-form'),
    };
    card.formEl.elements.subtype.addEventListener('change', () => applySubtypeArgHints(card.formEl));
    applySubtypeArgHints(card.formEl); // set the initial hint for the default-selected subtype

    card.formEl.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(card.formEl);
      socket.emit('server:command', {
        id,
        target: fd.get('targetId'),
        subtype: fd.get('subtype'),
        args: fd.get('args') || undefined,
      });
    });
    serverCards.set(id, card);
  }
  return card;
}

function renderServers(list) {
  latestServers = list;
  const seen = new Set();
  for (const server of list) {
    seen.add(server.id);
    const card = ensureServerCard(server.id);
    card.titleEl.innerHTML = `Server :${server.port}
      <span class="badge status-${server.status}">${server.status}</span>
      ${server.secured ? '<span class="badge secured">secured</span>' : ''}`;

    card.actionsEl.innerHTML = '';
    if (server.status === 'running' || server.status === 'starting') {
      const killBtn = document.createElement('button');
      killBtn.className = 'kill';
      killBtn.textContent = 'Kill';
      killBtn.onclick = () => socket.emit('server:kill', { id: server.id });
      card.actionsEl.appendChild(killBtn);
    } else {
      const startBtn = document.createElement('button');
      startBtn.className = 'start';
      startBtn.textContent = 'Start';
      startBtn.title = 'Respawn on the same port' + (server.secured ? ' with the same secret' : '');
      startBtn.onclick = () => socket.emit('server:start', { id: server.id });

      const removeBtn = document.createElement('button');
      removeBtn.textContent = 'Remove';
      removeBtn.onclick = () => socket.emit('server:remove', { id: server.id });

      card.actionsEl.append(startBtn, removeBtn);
    }

    card.nodesEl.innerHTML = '';
    for (const node of server.nodes) {
      const chip = document.createElement('span');
      chip.className = 'node-chip';
      chip.textContent = node.nodeType ? `${node.nodeId} (${node.nodeType}/${node.plotId})` : node.nodeId;
      chip.title = 'Click to target this node in the command form below';
      chip.onclick = () => {
        card.formEl.elements.targetId.value = node.nodeId;
      };
      card.nodesEl.appendChild(chip);
    }
  }
  for (const [id, card] of serverCards) {
    if (!seen.has(id)) {
      card.el.remove();
      serverCards.delete(id);
    }
  }
  refreshTargetServerOptions();
}

// ---- client cards ----
function ensureClientCard(id) {
  let card = clientCards.get(id);
  if (!card) {
    const el = document.createElement('div');
    el.className = 'card';
    el.innerHTML = `
      <div class="card-header">
        <span class="card-title"></span>
        <div class="card-actions"></div>
      </div>
      <div class="log-panel"></div>
    `;
    clientListEl.appendChild(el);
    card = {
      el,
      titleEl: el.querySelector('.card-title'),
      actionsEl: el.querySelector('.card-actions'),
      logEl: el.querySelector('.log-panel'),
    };
    clientCards.set(id, card);
  }
  return card;
}

function renderClients(list) {
  const seen = new Set();
  for (const client of list) {
    seen.add(client.id);
    const card = ensureClientCard(client.id);
    card.titleEl.innerHTML = `${client.nodeId}
      <span class="badge status-${client.status}">${client.status}</span>
      <br><small>${client.nodeType} / ${client.plotId} &rarr; ${client.targetHost}:${client.targetPort}${client.hasToken ? ' (token)' : ''}</small>`;

    card.actionsEl.innerHTML = '';
    if (client.status === 'running' || client.status === 'starting') {
      const stopBtn = document.createElement('button');
      stopBtn.className = 'stop';
      stopBtn.textContent = 'Stop';
      stopBtn.title = 'Graceful: sends a SHUTDOWN COMMAND via its server (sends UNREGISTER, exits on its own)';
      stopBtn.onclick = () => socket.emit('client:stop', { id: client.id });

      const killBtn = document.createElement('button');
      killBtn.className = 'kill';
      killBtn.textContent = 'Kill';
      killBtn.title = 'Ungraceful: SIGKILL — demos the server-side ECONNRESET cleanup, not client-side reconnect';
      killBtn.onclick = () => socket.emit('client:kill', { id: client.id });

      card.actionsEl.append(stopBtn, killBtn);
    } else {
      const startBtn = document.createElement('button');
      startBtn.className = 'start';
      startBtn.textContent = 'Start';
      startBtn.title = 'Respawn with the same node/target settings';
      startBtn.onclick = () => socket.emit('client:start', { id: client.id });

      const removeBtn = document.createElement('button');
      removeBtn.textContent = 'Remove';
      removeBtn.onclick = () => socket.emit('client:remove', { id: client.id });

      card.actionsEl.append(startBtn, removeBtn);
    }
  }
  for (const [id, card] of clientCards) {
    if (!seen.has(id)) {
      card.el.remove();
      clientCards.delete(id);
    }
  }
}

function refreshTargetServerOptions() {
  const previous = targetServerSelect.value;
  targetServerSelect.innerHTML = '<option value="">— manual host/port below —</option>';
  for (const server of latestServers) {
    if (server.status !== 'running') continue;
    const opt = document.createElement('option');
    opt.value = String(server.port);
    opt.textContent = `127.0.0.1:${server.port}${server.secured ? ' (secured)' : ''}`;
    targetServerSelect.appendChild(opt);
  }
  if ([...targetServerSelect.options].some((o) => o.value === previous)) {
    targetServerSelect.value = previous;
  }
}

targetServerSelect.addEventListener('change', () => {
  if (targetServerSelect.value) {
    clientHostInput.value = '127.0.0.1';
    clientPortInput.value = targetServerSelect.value;
  }
});

// ---- socket wiring ----
socket.on('init', (data) => {
  suggestedPort = data.suggestedPort;
  serverPortInput.value = suggestedPort;
  renderServers(data.servers);
  renderClients(data.clients);
  for (const entry of data.logs.server) {
    const card = serverCards.get(entry.id);
    if (card) appendLogLine(card.logEl, entry.line);
  }
  for (const entry of data.logs.client) {
    const card = clientCards.get(entry.id);
    if (card) appendLogLine(card.logEl, entry.line);
  }
});

socket.on('server:list', renderServers);
socket.on('client:list', renderClients);

socket.on('log', ({ kind, id, line }) => {
  const card = (kind === 'server' ? serverCards : clientCards).get(id);
  if (card) appendLogLine(card.logEl, line);
});

// ---- create forms ----
document.getElementById('server-create-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const port = Number(serverPortInput.value);
  const secret = serverSecretInput.value.trim();
  socket.emit('server:create', { port, secret: secret || undefined }, (res) => {
    if (!res.ok) return alert(`Failed to create server: ${res.error}`);
    suggestedPort = Math.max(suggestedPort, port + 1);
    serverPortInput.value = suggestedPort;
    serverSecretInput.value = '';
  });
});

document.getElementById('client-create-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const payload = {
    nodeType: document.getElementById('client-type').value,
    nodeId: clientIdInput.value.trim(),
    plotId: document.getElementById('client-plot').value.trim(),
    targetHost: clientHostInput.value.trim(),
    targetPort: Number(clientPortInput.value),
    interval: Number(document.getElementById('client-interval').value),
    token: clientTokenInput.value.trim() || undefined,
  };
  socket.emit('client:create', payload, (res) => {
    if (!res.ok) return alert(`Failed to create client: ${res.error}`);
    clientIdInput.value = '';
  });
});
