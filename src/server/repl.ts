// Interactive operator REPL on stdin: lets you send COMMAND to any registered node (or every
// node in a plot, ADR 0010) interactively — this is how this hybrid protocol demonstrates the
// server -> node direction during the demo, not automatically.

import * as readline from 'readline';
import { CommandName } from '../protocol/types';
import { encodeRequest } from '../protocol/codec';
import { nodes } from './connectionTable';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: '> ' });

function printHelp() {
  console.log(`
Commands:
  list                                                   list registered nodes
  command <Node-ID|Plot-ID> SET_INTERVAL <seconds>       change how often node(s) push
  command <Node-ID|Plot-ID> REPORT_NOW                   ask node(s) to push immediately
  command <Node-ID|Plot-ID> SET_THRESHOLD <field> <min>  ask node(s) to push early if field < min
  command <Node-ID|Plot-ID> CALIBRATE <offset>           adjust node(s) sensor offset
  command <Node-ID|Plot-ID> SHUTDOWN                     tell node(s) to disconnect
  help                                                    show this message

  <Node-ID|Plot-ID>: a single Node-ID (e.g. TEMP-01) targets that node; a Plot-ID
  (e.g. PLOT-01) broadcasts the same COMMAND to every node registered in that plot.
`);
}

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

export function startRepl() {
  rl.on('line', (line) => {
    const parts = line.trim().split(/\s+/);
    const cmd = parts[0];

    if (cmd === 'help' || cmd === '') {
      printHelp();
    } else if (cmd === 'list') {
      console.log(`registered nodes: [${[...nodes.keys()].join(', ')}]`);
    } else if (cmd === 'command') {
      const target = parts[1];
      const commandName = parts[2] as CommandName;
      const payload = buildCommandPayload(commandName, parts.slice(3));

      if (payload === null) {
        console.log(`Unknown or malformed COMMAND: ${parts.slice(2).join(' ')}`);
      } else {
        // ADR 0010: target may be a single Node-ID (existing behavior) or a Plot-ID, which
        // fans the same COMMAND out to every node registered in that plot.
        const singleNode = target ? nodes.get(target) : undefined;
        const targets = singleNode ? [singleNode] : [...nodes.values()].filter((n) => n.plotId === target);

        if (targets.length === 0) {
          console.log(`No such registered node or plot: '${target}'`);
        } else {
          for (const node of targets) {
            const req = encodeRequest('COMMAND', { 'Node-ID': node.nodeId }, payload);
            node.socket.write(req);
            console.log(`[${node.nodeId}] -> COMMAND ${JSON.stringify(payload)}`);
          }
        }
      }
    } else {
      console.log(`Unknown operator command: '${cmd}'. Type 'help'.`);
    }

    rl.prompt();
  });

  rl.prompt();
}
