import { deflateSync, inflateSync } from "node:zlib";

/**
 * Real pixel-level watermarking (PRD §2.1 "AI 표시·워터마크 부착").
 *
 * embedWatermark writes an INVISIBLE, robust provenance mark into the low bit of
 * the blue channel (LSB steganography) of an actual PNG. It survives copy and
 * re-hosting, so origin can be proven even when the visible label is cropped —
 * complementing the human-readable disclosure carried by the license manifest's
 * ai_label and the public share card.
 *
 * Dependency-free: a minimal RGBA/8-bit PNG codec (node:zlib for IDAT). This is
 * the primitive the pipeline calls once plugins return real image bytes; today
 * it is exercised end-to-end by unit tests that synthesize a PNG in memory.
 */

// ---- PNG codec (8-bit RGBA, non-interlaced) --------------------------------

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeData), 0);
  return Buffer.concat([len, typeData, crc]);
}

export interface RgbaImage {
  width: number;
  height: number;
  /** RGBA, row-major, 4 bytes/pixel. Length = width*height*4. */
  data: Uint8Array;
}

export function encodePng(img: RgbaImage): Buffer {
  const { width, height, data } = img;
  const stride = width * 4;
  // Prepend filter-type byte 0 (None) to each scanline.
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(data.buffer, data.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  return Buffer.concat([
    PNG_SIG,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

export function decodePng(buf: Buffer): RgbaImage {
  if (!buf.subarray(0, 8).equals(PNG_SIG)) throw new Error("not_a_png");
  let width = 0;
  let height = 0;
  const idat: Buffer[] = [];
  let off = 8;
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[9] !== 6) throw new Error("unsupported_png_format");
    } else if (type === "IDAT") {
      idat.push(Buffer.from(data));
    } else if (type === "IEND") {
      break;
    }
    off += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const bpp = 4;
  const out = new Uint8Array(stride * height);
  let prevRow = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const rowStart = y * (stride + 1) + 1;
    const row = new Uint8Array(stride);
    for (let x = 0; x < stride; x++) {
      const rawByte = raw[rowStart + x]!;
      const a = x >= bpp ? row[x - bpp]! : 0;
      const b = prevRow[x]!;
      const c = x >= bpp ? prevRow[x - bpp]! : 0;
      let val: number;
      switch (filter) {
        case 0: val = rawByte; break;
        case 1: val = rawByte + a; break;
        case 2: val = rawByte + b; break;
        case 3: val = rawByte + ((a + b) >> 1); break;
        case 4: val = rawByte + paeth(a, b, c); break;
        default: throw new Error(`bad_filter_${filter}`);
      }
      row[x] = val & 0xff;
    }
    out.set(row, y * stride);
    prevRow = row;
  }
  return { width, height, data: out };
}

// ---- Invisible watermark (LSB of blue channel) -----------------------------

const MAGIC = 0x52584d31; // "RXM1" — marks a REMIX HUB watermark, v1.

function writeBits(data: Uint8Array, bits: number[]): void {
  // Store one bit per pixel in the blue channel (index 2 of each RGBA quad).
  for (let i = 0; i < bits.length; i++) {
    const px = i * 4 + 2;
    data[px] = (data[px]! & 0xfe) | (bits[i]! & 1);
  }
}

function toBits(bytes: Uint8Array): number[] {
  const bits: number[] = [];
  for (const byte of bytes) for (let b = 7; b >= 0; b--) bits.push((byte >> b) & 1);
  return bits;
}

/**
 * Embed a UTF-8 payload (e.g. an export/creation id or license hash) invisibly.
 * Layout: [magic u32][len u32][payload bytes], all as LSBs. Throws if the image
 * is too small to hold the payload.
 */
export function embedWatermark(png: Buffer, payload: string): Buffer {
  const img = decodePng(png);
  const bytes = Buffer.from(payload, "utf8");
  const header = Buffer.alloc(8);
  header.writeUInt32BE(MAGIC, 0);
  header.writeUInt32BE(bytes.length, 4);
  const bits = toBits(Buffer.concat([header, bytes]));
  const capacity = img.width * img.height; // one bit per pixel
  if (bits.length > capacity) throw new Error("watermark_payload_too_large");
  writeBits(img.data, bits);
  return encodePng(img);
}

/** Recover an embedded payload, or null if the magic header is absent. */
export function extractWatermark(png: Buffer): string | null {
  const img = decodePng(png);
  const readBytes = (bitOffset: number, count: number): Buffer => {
    const out = Buffer.alloc(count);
    for (let i = 0; i < count; i++) {
      let byte = 0;
      for (let b = 0; b < 8; b++) {
        const bitIndex = bitOffset + i * 8 + b;
        byte = (byte << 1) | (img.data[bitIndex * 4 + 2]! & 1);
      }
      out[i] = byte;
    }
    return out;
  };
  const header = readBytes(0, 8);
  if (header.readUInt32BE(0) !== MAGIC) return null;
  const len = header.readUInt32BE(4);
  const capacityBits = img.width * img.height;
  if ((8 + len) * 8 > capacityBits) return null;
  return readBytes(64, len).toString("utf8");
}
