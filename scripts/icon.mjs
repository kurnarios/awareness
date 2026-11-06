// Deterministic, code-native clock mark; no image-generation service or build dependencies.
import { deflateSync, inflateSync } from 'node:zlib';
function chunk(type, data) {
  const text = Buffer.from(type), combined = Buffer.concat([text, data]);
  let crc = 0xffffffff;
  for (const byte of combined) { crc ^= byte; for (let i = 0; i < 8; i++) crc = crc & 1 ? 0xedb88320 ^ crc >>> 1 : crc >>> 1; }
  const length = Buffer.alloc(4), checksum = Buffer.alloc(4);
  length.writeUInt32BE(data.length); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, combined, checksum]);
}
export function sameIconPNG(actual, expected) {
  if (actual.equals(expected)) return true;
  try {
    // The generated format is signature + IHDR + one IDAT + IEND. Compare
    // metadata and pixels exactly; valid zlib compression can vary by runtime.
    if (!actual.subarray(0, 33).equals(expected.subarray(0, 33)) ||
        !actual.subarray(-12).equals(expected.subarray(-12))) return false;
    const pixels = png => {
      if (png.length < 57 || png.readUInt32BE(33) !== png.length - 57) throw new Error('Invalid IDAT length');
      const data = png.subarray(41, -16);
      if (!chunk('IDAT', data).equals(png.subarray(33, -12))) throw new Error('Invalid IDAT checksum');
      return inflateSync(data, { maxOutputLength: (512 * 3 + 1) * 512 });
    };
    return pixels(actual).equals(pixels(expected));
  } catch { return false; }
}
export function iconPNG() {
  const size = 512, scale = 2, image = Buffer.alloc((size * 3 + 1) * size);
  const segment = (x, y, ax, ay, bx, by, r) => {
    const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)));
    return Math.hypot(x - ax - t * (bx - ax), y - ay - t * (by - ay)) < r;
  };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const color = [0, 0, 0];
    for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) {
      const u = x + (sx + 0.5) / scale, v = y + (sy + 0.5) / scale;
      const radius = Math.hypot(u - 256, v - 256);
      let rgb = [15, 23, 42];
      if (Math.abs(radius - 165) < 13) rgb = [45, 212, 191];
      if (segment(u, v, 256, 256, 256, 157, 11) || segment(u, v, 256, 256, 332, 299, 11) || radius < 17) rgb = [248, 250, 252];
      for (let tick = 0; tick < 10; tick++) {
        const a = tick * Math.PI / 5 - Math.PI / 2;
        if (Math.hypot(u - 256 - Math.cos(a) * 207, v - 256 - Math.sin(a) * 207) < 7) rgb = tick < 7 ? [45, 212, 191] : [51, 65, 85];
      }
      rgb.forEach((n, i) => color[i] += n / (scale * scale));
    }
    const offset = y * (size * 3 + 1) + x * 3 + 1;
    color.forEach((n, i) => image[offset + i] = Math.round(n));
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(image)), chunk('IEND', Buffer.alloc(0))]);
}
