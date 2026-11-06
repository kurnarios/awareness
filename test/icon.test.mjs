import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync, inflateSync } from 'node:zlib';
import { iconPNG, sameIconPNG } from '../scripts/icon.mjs';

const original = iconPNG();
const pixels = inflateSync(original.subarray(41, -16));
function reencode(data, level) {
  const compressed = deflateSync(data, { level });
  const idat = Buffer.concat([Buffer.from('IDAT'), compressed]);
  let crc = 0xffffffff;
  for (const byte of idat) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  const length = Buffer.alloc(4), checksum = Buffer.alloc(4);
  length.writeUInt32BE(compressed.length);
  checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([original.subarray(0, 33), length, idat, checksum, original.subarray(-12)]);
}

test('icon checks accept identical pixels with different valid compression', () => {
  assert.ok(sameIconPNG(original, original));
  for (const level of [0, 1, 9]) {
    const encoded = reencode(pixels, level);
    assert.ok(sameIconPNG(encoded, original), `compression level ${level}`);
  }
  assert.ok(!reencode(pixels, 0).equals(original));
});

test('icon checks reject changed pixels, metadata, corruption, and truncation', () => {
  const changed = Buffer.from(pixels);
  changed[1] ^= 1;
  assert.equal(sameIconPNG(reencode(changed, 6), original), false);
  for (const index of [0, 16, 33, 37, 41, original.length - 13, original.length - 1]) {
    const corrupted = Buffer.from(original);
    corrupted[index] ^= 1;
    assert.equal(sameIconPNG(corrupted, original), false, `corruption at ${index}`);
  }
  for (const length of [0, 8, 32, 56, original.length - 1]) {
    assert.equal(sameIconPNG(original.subarray(0, length), original), false);
  }
});
