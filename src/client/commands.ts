import { ParsedRequest, ParsedMessage } from '../protocol/types';
import { encodeResponse, encodeRequest, MessageParser } from '../protocol/codec';
import { ClientState } from './sensors';

export interface CommandContext {
  nodeId: string;
  state: ClientState;
  send: (buf: Buffer) => void;
  log: (direction: '<-' | '->', msg: ParsedMessage) => void;
  pushReading: () => void;
  markIntentionalDisconnect: () => void;
}

export function handleCommand(req: ParsedRequest, ctx: CommandContext) {
  const command = req.body.command as string;
  let responseBody: Record<string, unknown> = { message: `Command '${command}' applied` };

  switch (command) {
    case 'SET_INTERVAL': {
      const seconds = Number(req.body.seconds);
      ctx.state.intervalSeconds = seconds;
      if (ctx.state.pushTimer) {
        clearInterval(ctx.state.pushTimer);
        ctx.state.pushTimer = setInterval(ctx.pushReading, ctx.state.intervalSeconds * 1000);
      }
      console.log(`  interval changed to ${seconds}s`);
      break;
    }
    case 'REPORT_NOW': {
      const res = encodeResponse(200, {}, responseBody);
      ctx.send(res);
      ctx.log('->', new MessageParser().push(res)[0]);
      ctx.pushReading();
      return; // response already sent above
    }
    case 'SET_THRESHOLD': {
      ctx.state.threshold = { field: String(req.body.field), min: Number(req.body.min) };
      console.log(`  threshold set: push early if ${ctx.state.threshold.field} < ${ctx.state.threshold.min}`);
      break;
    }
    case 'CALIBRATE': {
      ctx.state.calibrationOffset = Number(req.body.offset);
      console.log(`  calibration offset set to ${ctx.state.calibrationOffset}`);
      break;
    }
    case 'SHUTDOWN': {
      const res = encodeResponse(200, {}, { message: 'Shutting down' });
      ctx.send(res);
      ctx.log('->', new MessageParser().push(res)[0]);
      if (ctx.state.pushTimer) clearInterval(ctx.state.pushTimer);
      ctx.markIntentionalDisconnect();
      const unreg = encodeRequest('UNREGISTER', { 'Node-ID': ctx.nodeId });
      ctx.send(unreg);
      ctx.log('->', new MessageParser().push(unreg)[0]);
      return;
    }
    default:
      responseBody = { message: `Unknown command: ${command}` };
  }

  const res = encodeResponse(200, {}, responseBody);
  ctx.send(res);
  ctx.log('->', new MessageParser().push(res)[0]);
}
