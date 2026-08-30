// Unit tests for the VMP wire format (src/protocol/*). Pure functions, no sockets —
// covers encode/decode round-tripping and the TCP-chunking edge cases MessageParser
// exists to handle (see docs/adr/0004).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { encodeRequest, encodeResponse, MessageParser, formatForLog } from '../src/protocol/codec';
import { STATUS_PHRASES, VMP_VERSION } from '../src/protocol/types';

describe('encodeRequest / encodeResponse', () => {
  test('encodes a request with headers and a JSON body', () => {
    const buf = encodeRequest('PUSH', { 'Node-ID': 'TEMP-01', Seq: '3' }, { temperature: 28.5 });
    const text = buf.toString('utf8');
    assert.match(text, /^PUSH VMP\/1\.0\n/);
    assert.match(text, /Node-ID: TEMP-01\n/);
    assert.match(text, /Seq: 3\n/);
    assert.match(text, /Content-Length: \d+\n/);
    assert.ok(text.endsWith('{"temperature":28.5}'));
  });

  test('encodes a response using the STATUS_PHRASES table', () => {
    const buf = encodeResponse(201, {}, { message: 'Registered successfully' });
    const text = buf.toString('utf8');
    assert.match(text, new RegExp(`^${VMP_VERSION.replace('/', '\\/')} 201 ${STATUS_PHRASES[201]}\n`));
  });

  test('falls back to "Unknown" for an unmapped status code', () => {
    const buf = encodeResponse(599, {}, {});
    assert.match(buf.toString('utf8'), /599 Unknown/);
  });

  test('Content-Length matches the actual UTF-8 byte length of the body, not char length', () => {
    // Thai text has multi-byte UTF-8 characters — this would drift if Content-Length
    // used .length (UTF-16 code units) instead of Buffer.byteLength.
    const body = { message: 'ลงทะเบียนสำเร็จ' };
    const buf = encodeResponse(200, {}, body);
    const bodyStr = JSON.stringify(body);
    const declaredLength = Number(buf.toString('utf8').match(/Content-Length: (\d+)/)![1]);
    assert.equal(declaredLength, Buffer.byteLength(bodyStr, 'utf8'));
    assert.notEqual(declaredLength, bodyStr.length); // sanity: proves the multi-byte case actually differs
  });
});

describe('MessageParser', () => {
  test('parses a single complete message in one chunk', () => {
    const parser = new MessageParser();
    const wire = encodeRequest('REGISTER', { 'Node-ID': 'TEMP-01', 'Node-Type': 'TempHumidNode', 'Plot-ID': 'PLOT-01' });
    const [msg] = parser.push(wire);
    assert.equal(msg.kind, 'request');
    if (msg.kind === 'request') {
      assert.equal(msg.method, 'REGISTER');
      assert.equal(msg.headers['Node-ID'], 'TEMP-01');
    }
  });

  test('buffers a message split across multiple chunks (partial header + partial body)', () => {
    const parser = new MessageParser();
    const wire = encodeRequest('PUSH', { 'Node-ID': 'SOIL-01', Seq: '1' }, { soil_ph: 6.8, soil_moisture: 40 });
    const cut = Math.floor(wire.length / 2); // split mid-message, not necessarily on a clean boundary

    assert.deepEqual(parser.push(wire.subarray(0, cut)), []); // nothing complete yet
    const [msg] = parser.push(wire.subarray(cut));
    assert.equal(msg.kind, 'request');
    if (msg.kind === 'request') {
      assert.equal(msg.body.soil_ph, 6.8);
    }
  });

  test('returns multiple messages when several arrive back-to-back in one chunk', () => {
    const parser = new MessageParser();
    const a = encodeRequest('PUSH', { 'Node-ID': 'TEMP-01', Seq: '1' }, { temperature: 30 });
    const b = encodeRequest('PUSH', { 'Node-ID': 'TEMP-01', Seq: '2' }, { temperature: 31 });
    const messages = parser.push(Buffer.concat([a, b]));

    assert.equal(messages.length, 2);
    assert.equal(messages[0].headers['Seq'], '1');
    assert.equal(messages[1].headers['Seq'], '2');
  });

  test('parses a response start line (VMP/1.0 CODE PHRASE) distinctly from a request', () => {
    const parser = new MessageParser();
    const [msg] = parser.push(encodeResponse(409, {}, { message: 'duplicate' }));
    assert.equal(msg.kind, 'response');
    if (msg.kind === 'response') {
      assert.equal(msg.statusCode, 409);
      assert.equal(msg.statusPhrase, 'DuplicateNode');
    }
  });

  test('an empty body produces an empty object, not a parse error', () => {
    const parser = new MessageParser();
    const [msg] = parser.push(encodeRequest('STATUS', { 'Node-ID': 'TEMP-01' }));
    assert.deepEqual(msg.body, {});
  });
});

describe('formatForLog', () => {
  test('formats a request as "METHOD VERSION | headers | body"', () => {
    const parser = new MessageParser();
    const [msg] = parser.push(encodeRequest('REGISTER', { 'Node-ID': 'TEMP-01' }));
    const line = formatForLog(msg);
    assert.match(line, /^REGISTER VMP\/1\.0 \| /);
    assert.match(line, /"Node-ID":"TEMP-01"/);
  });

  test('formats a response as "VERSION CODE PHRASE | headers | body"', () => {
    const parser = new MessageParser();
    const [msg] = parser.push(encodeResponse(200, {}, { registered: true }));
    assert.match(formatForLog(msg), /^VMP\/1\.0 200 OK \| .* \| \{"registered":true\}$/);
  });
});
