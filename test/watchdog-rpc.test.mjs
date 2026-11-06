import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { connect } from '../scripts/watchdog-rpc.mjs';
import { deliver } from '../scripts/watchdog.mjs';
import { defaults } from '../scripts/watchdog-config.mjs';

function frame(data, opcode = 1, final = true) {
  const body = Buffer.from(data), header = Buffer.alloc(body.length < 126 ? 2 : 4);
  header[0] = (final ? 128 : 0) | opcode;
  header[1] = body.length < 126 ? body.length : 126;
  if (header.length === 4) header.writeUInt16BE(body.length, 2);
  return Buffer.concat([header, body]);
}
async function server(t, reply, { badHandshake = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'watchdog-rpc-'));
  const socketPath = path.join(dir, 'rpc.sock'), sockets = new Set();
  const host = http.createServer();
  host.on('connection', s => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  host.on('upgrade', (request, socket) => {
    const accept = crypto.createHash('sha1').update(request.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${badHandshake ? 'invalid' : accept}\r\n\r\n`);
    socket.write(frame('ping', 9));
    let buffer = Buffer.alloc(0);
    socket.on('data', data => {
      buffer = Buffer.concat([buffer, data]);
      while (buffer.length >= 2) {
        const opcode = buffer[0] & 15;
        assert.ok(buffer[1] & 128, 'clients must mask frames');
        let size = buffer[1] & 127, offset = 2;
        if (size === 126) { if (buffer.length < 4) return; size = buffer.readUInt16BE(2); offset = 4; }
        if (buffer.length < offset + 4 + size) return;
        const mask = buffer.subarray(offset, offset + 4), body = Buffer.from(buffer.subarray(offset + 4, offset + 4 + size));
        buffer = buffer.subarray(offset + 4 + size);
        for (let i = 0; i < body.length; i++) body[i] ^= mask[i % 4];
        if (opcode === 10) continue;
        const message = JSON.parse(body.toString());
        if (!message.id) continue;
        const response = message.method === 'initialize' ? {} : reply(message);
        if (response === undefined) continue;
        const json = JSON.stringify({ id: message.id, result: response });
        const half = Math.floor(json.length / 2);
        socket.write(frame(json.slice(0, half), 1, false));
        socket.write(frame(json.slice(half), 0, true));
      }
    });
  });
  await new Promise(resolve => host.listen(socketPath, resolve));
  t.after(async () => { for (const socket of sockets) socket.destroy(); await new Promise(resolve => host.close(resolve)); fs.rmSync(dir, { recursive: true, force: true }); });
  return socketPath;
}

test('local socket client performs a validated masked handshake and queue round-trip with fragmented replies', async t => {
  const methods = [];
  const socketPath = await server(t, message => {
    methods.push(message.method);
    if (message.method === 'thread/read') return { thread: { id: 'child', status: { type: 'idle' } } };
    if (message.method === 'thread/queue/list') return { data: [], nextCursor: null };
    if (message.method === 'thread/queue/add') {
      assert.equal(message.params.threadId, 'child');
      assert.ok(message.params.input[0].text.includes('not user approval'));
      return { queuedSubmission: { id: 'watchdog-item' } };
    }
    if (message.method === 'thread/queue/start') return { turn: { id: 'turn' } };
    if (message.method === 'thread/queue/delete') return {};
    throw new Error(message.method);
  });
  const rpc = await connect(socketPath);
  try {
    assert.equal(await deliver(rpc, { threadId: 'child', alarm: 'one', config: defaults }), 'started');
    assert.equal(methods.filter(m => m === 'thread/queue/start').length, 1);
    assert.ok(methods.every(m => m.startsWith('thread/queue/') || m === 'thread/read'));
  } finally { rpc.close(); }
});

test('local socket client rejects remote endpoints and invalid upgrades and bounds missing replies', async t => {
  await assert.rejects(connect('ws://example.test'), /Local socket/);
  const invalid = await server(t, () => ({}), { badHandshake: true });
  await assert.rejects(connect(invalid), /Invalid socket upgrade/);
  const silent = await server(t, () => undefined);
  const rpc = await connect(silent, { timeoutMs: 100 });
  try { await assert.rejects(rpc.request('thread/read', {}), /timeout/); }
  finally { rpc.close(); }
});
