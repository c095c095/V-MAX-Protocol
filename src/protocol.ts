// VMP (V MAX Protocol) — shared protocol implementation used by both server.ts and client.ts.
//
// Wire format (see docs/adr/0002 and docs/adr/0004):
//
//   REQUEST:
//     METHOD VMP/1.0\n
//     Header-Name: value\n
//     ...
//     Content-Length: N\n
//     \n
//     <N bytes of JSON body>
//
//   RESPONSE:
//     VMP/1.0 CODE PHRASE\n
//     Header-Name: value\n
//     ...
//     Content-Length: N\n
//     \n
//     <N bytes of JSON body>

export const VMP_VERSION = 'VMP/1.0';

export type NodeType = 'TempHumidNode' | 'SoilNode' | 'LightNode';

export const NODE_TYPE_PREFIX: Record<NodeType, string> = {
  TempHumidNode: 'TEMP',
  SoilNode: 'SOIL',
  LightNode: 'LIGHT',
};

export type RequestMethod = 'REGISTER' | 'PUSH' | 'COMMAND' | 'STATUS' | 'UNREGISTER';

export type CommandName =
  | 'SET_INTERVAL'
  | 'REPORT_NOW'
  | 'SET_THRESHOLD'
  | 'CALIBRATE'
  | 'SHUTDOWN';

export const STATUS_PHRASES: Record<number, string> = {
  200: 'OK',
  201: 'Registered',
  400: 'BadRequest',
  401: 'Unregistered',
  404: 'NodeNotFound',
  409: 'DuplicateNode',
  500: 'InternalError',
};

export interface ParsedRequest {
  kind: 'request';
  method: RequestMethod;
  version: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

export interface ParsedResponse {
  kind: 'response';
  version: string;
  statusCode: number;
  statusPhrase: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

export type ParsedMessage = ParsedRequest | ParsedResponse;

/** Encode a request message (node -> server, or server -> node for COMMAND) into wire bytes. */
export function encodeRequest(
  method: RequestMethod,
  headers: Record<string, string>,
  body: Record<string, unknown> = {}
): Buffer {
  const bodyStr = JSON.stringify(body);
  const bodyBytes = Buffer.byteLength(bodyStr, 'utf8');
  const headerLines = [
    `${method} ${VMP_VERSION}`,
    ...Object.entries(headers).map(([k, v]) => `${k}: ${v}`),
    `Content-Length: ${bodyBytes}`,
  ];
  const head = headerLines.join('\n') + '\n\n';
  return Buffer.concat([Buffer.from(head, 'utf8'), Buffer.from(bodyStr, 'utf8')]);
}

/** Encode a response message into wire bytes. */
export function encodeResponse(
  statusCode: number,
  headers: Record<string, string> = {},
  body: Record<string, unknown> = {}
): Buffer {
  const phrase = STATUS_PHRASES[statusCode] ?? 'Unknown';
  const bodyStr = JSON.stringify(body);
  const bodyBytes = Buffer.byteLength(bodyStr, 'utf8');
  const headerLines = [
    `${VMP_VERSION} ${statusCode} ${phrase}`,
    ...Object.entries(headers).map(([k, v]) => `${k}: ${v}`),
    `Content-Length: ${bodyBytes}`,
  ];
  const head = headerLines.join('\n') + '\n\n';
  return Buffer.concat([Buffer.from(head, 'utf8'), Buffer.from(bodyStr, 'utf8')]);
}

/**
 * Buffers incoming TCP chunks and yields complete VMP messages as they become available.
 * Needed because TCP is a byte stream: a single `data` event is NOT guaranteed to contain
 * exactly one message (it may contain a partial message, or several messages back-to-back).
 */
export class MessageParser {
  private buffer: Buffer = Buffer.alloc(0);

  /** Feed newly-arrived bytes in. Returns every message that is now fully available. */
  push(chunk: Buffer): ParsedMessage[] {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const messages: ParsedMessage[] = [];

    for (;;) {
      const headerEnd = this.buffer.indexOf('\n\n');
      if (headerEnd === -1) break; // headers not fully received yet

      const headerBlock = this.buffer.subarray(0, headerEnd).toString('utf8');
      const [startLine, ...headerLines] = headerBlock.split('\n');

      const headers: Record<string, string> = {};
      for (const line of headerLines) {
        const idx = line.indexOf(':');
        if (idx === -1) continue;
        headers[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
      }

      const contentLength = parseInt(headers['Content-Length'] ?? '0', 10) || 0;
      const bodyStart = headerEnd + 2; // skip the blank line
      const bodyEnd = bodyStart + contentLength;

      if (this.buffer.length < bodyEnd) break; // body not fully received yet

      const bodyStr = this.buffer.subarray(bodyStart, bodyEnd).toString('utf8');
      let body: Record<string, unknown> = {};
      try {
        body = bodyStr.length > 0 ? JSON.parse(bodyStr) : {};
      } catch {
        body = {};
      }

      messages.push(parseStartLine(startLine, headers, body));
      this.buffer = this.buffer.subarray(bodyEnd);
    }

    return messages;
  }
}

function parseStartLine(
  startLine: string,
  headers: Record<string, string>,
  body: Record<string, unknown>
): ParsedMessage {
  if (startLine.startsWith('VMP/')) {
    const [version, codeStr, ...phraseParts] = startLine.split(' ');
    return {
      kind: 'response',
      version,
      statusCode: parseInt(codeStr, 10),
      statusPhrase: phraseParts.join(' '),
      headers,
      body,
    };
  }
  const [method, version] = startLine.split(' ');
  return {
    kind: 'request',
    method: method as RequestMethod,
    version,
    headers,
    body,
  };
}

/** Human-readable one-liner for terminal logging (assignment requires printing message + status). */
export function formatForLog(msg: ParsedMessage): string {
  const bodyStr = JSON.stringify(msg.body);
  if (msg.kind === 'request') {
    return `${msg.method} ${msg.version} | ${JSON.stringify(msg.headers)} | ${bodyStr}`;
  }
  return `${msg.version} ${msg.statusCode} ${msg.statusPhrase} | ${JSON.stringify(msg.headers)} | ${bodyStr}`;
}
