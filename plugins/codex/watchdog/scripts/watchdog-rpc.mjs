// Small local-only JSON-RPC/WebSocket client. Never connects to TCP or a remote service.
import net from 'node:net';
import crypto from 'node:crypto';

export async function connect(socketPath, { timeoutMs = 3000 } = {}) {
  if (typeof socketPath !== 'string' || !socketPath.startsWith('/')) throw new Error('Local socket required');
  const socket = net.createConnection(socketPath);
  const pending = new Map();
  let buffer = Buffer.alloc(0), upgraded = false, nextId = 0, fragment = [];
  let readyResolve, readyReject;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  const key = crypto.randomBytes(16).toString('base64');
  const expected = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  const handshake = setTimeout(() => fail(new Error('Socket handshake timeout')), timeoutMs);
  function fail(error) {
    clearTimeout(handshake);
    readyReject(error);
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error); }
    pending.clear(); socket.destroy();
  }
  function sendFrame(payload, opcode = 1) {
    const body = Buffer.from(payload), mask = crypto.randomBytes(4);
    const header = Buffer.alloc(body.length < 126 ? 2 : body.length < 65536 ? 4 : 10);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | (body.length < 126 ? body.length : body.length < 65536 ? 126 : 127);
    if (header.length === 4) header.writeUInt16BE(body.length, 2);
    if (header.length === 10) header.writeBigUInt64BE(BigInt(body.length), 2);
    for (let i = 0; i < body.length; i++) body[i] ^= mask[i % 4];
    socket.write(Buffer.concat([header, mask, body]));
  }
  socket.once('connect', () => socket.write(`GET / HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`));
  socket.on('error', fail);
  socket.on('close', () => fail(new Error('Socket closed')));
  socket.on('data', chunk => {
    try {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length > 2 * 1024 * 1024) throw new Error('Oversized local response');
      if (!upgraded) {
        const end = buffer.indexOf('\r\n\r\n');
        if (end < 0) return;
        const headers = buffer.subarray(0, end).toString();
        if (!headers.startsWith('HTTP/1.1 101 ') || !headers.toLowerCase().includes(`sec-websocket-accept: ${expected}`.toLowerCase())) throw new Error('Invalid socket upgrade');
        buffer = buffer.subarray(end + 4); upgraded = true;
        clearTimeout(handshake); readyResolve();
      }
      while (buffer.length >= 2) {
        const opcode = buffer[0] & 15, final = buffer[0] & 0x80;
        if (buffer[1] & 0x80) throw new Error('Masked server frame');
        let size = buffer[1] & 127, offset = 2;
        if (size === 126) { if (buffer.length < 4) return; size = buffer.readUInt16BE(2); offset = 4; }
        if (size === 127) { if (buffer.length < 10) return; size = Number(buffer.readBigUInt64BE(2)); offset = 10; }
        if (size > 1024 * 1024) throw new Error('Oversized frame');
        if (buffer.length < offset + size) return;
        const body = buffer.subarray(offset, offset + size); buffer = buffer.subarray(offset + size);
        if (opcode === 8) { socket.end(); return; }
        if (opcode === 9) { sendFrame(body, 10); continue; }
        if (opcode === 10) continue;
        if (![0, 1].includes(opcode)) throw new Error('Unsupported frame');
        fragment.push(body);
        if (fragment.reduce((sum, part) => sum + part.length, 0) > 1024 * 1024) throw new Error('Oversized message');
        if (!final) continue;
        const message = JSON.parse(Buffer.concat(fragment).toString()); fragment = [];
        const item = pending.get(message.id);
        if (!item) continue;
        pending.delete(message.id); clearTimeout(item.timer);
        if (message.error) item.reject(new Error(message.error.message || 'Local RPC error'));
        else item.resolve(message.result);
      }
    } catch (error) { fail(error); }
  });
  await ready;
  const request = (method, params) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('Local RPC timeout')); }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    sendFrame(JSON.stringify({ id, method, params }));
  });
  try {
    await request('initialize', { clientInfo: { name: 'awareness-watchdog', version: '0.4.0' }, capabilities: { experimentalApi: true } });
    sendFrame(JSON.stringify({ method: 'initialized' }));
  } catch (error) { socket.destroy(); throw error; }
  return { request, close: () => socket.destroy() };
}
