// Builds the portal's home-screen icons (phase 3 PR-PA2) into
// worker/src/portal-icons.generated.js: flat-colour squares with a white "Z"
// drawn from a fixed bitmap glyph, as 1-bit palette PNGs. The PNG bytes come
// from this file alone (its own deflate encoder: fixed Huffman codes, runs of
// one byte), never from the zlib library, so the output is the same on every
// Node version. node:zlib is used only to check that the result inflates back.
// Usage: node scripts/gen-portal-icons.mjs [--check]
//   --check  exits 1 when the committed file differs from a fresh build.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(root, "worker", "src", "portal-icons.generated.js");

const ICON_BG = [0x15, 0x2a, 0x4a];   // the manifest's background_color and theme_color (#152a4a)
const FG = [0xff, 0xff, 0xff];

// The glyph, 7 x 7 cells.
const GLYPH = [
  "#######",
  "     ##",
  "    ## ",
  "   ##  ",
  "  ##   ",
  " ##    ",
  "#######",
];

// name -> [size, share of the side the glyph spans]. A maskable icon keeps the
// glyph inside the central safe zone, so it is drawn smaller.
const ICONS = [
  ["icon-180.png", 180, 0.56],
  ["icon-192.png", 192, 0.56],
  ["icon-512.png", 512, 0.56],
  ["icon-mask-512.png", 512, 0.42],
];

// --- PNG ------------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function adler32(bytes) {
  let a = 1, b = 0;
  for (const x of bytes) { a = (a + x) % 65521; b = (b + a) % 65521; }
  return ((b << 16) | a) >>> 0;
}
const u32 = (n) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
function chunk(type, data) {
  const td = [...Buffer.from(type, "latin1"), ...data];
  return [...u32(data.length), ...td, ...u32(crc32(td))];
}

// A bit writer, least significant bit first (RFC 1951 3.1.1).
class Bits {
  constructor() { this.out = []; this.cur = 0; this.n = 0; }
  put(value, count) {
    for (let i = 0; i < count; i++) {
      this.cur |= ((value >>> i) & 1) << this.n;
      if (++this.n === 8) { this.out.push(this.cur); this.cur = 0; this.n = 0; }
    }
  }
  // Huffman codes are packed most significant bit first.
  code(value, len) { for (let i = len - 1; i >= 0; i--) this.put((value >>> i) & 1, 1); }
  done() { if (this.n) this.out.push(this.cur); return this.out; }
}
function literal(w, v) {
  if (v < 144) w.code(0x30 + v, 8);
  else if (v < 256) w.code(0x190 + v - 144, 9);
  else if (v < 280) w.code(v - 256, 7);
  else w.code(0xc0 + v - 280, 8);
}
const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
function match(w, len) {
  let i = LEN_BASE.length - 1;
  while (LEN_BASE[i] > len) i--;
  literal(w, 257 + i);
  w.put(len - LEN_BASE[i], LEN_EXTRA[i]);
  w.code(0, 5); // distance code 0: distance 1, no extra bits
}
// One final fixed-Huffman block; a run of one byte becomes the byte plus
// distance-1 copies. Wrapped in a zlib stream.
function deflate(data) {
  const w = new Bits();
  w.put(1, 1); // BFINAL
  w.put(1, 2); // BTYPE 01: fixed Huffman
  for (let i = 0; i < data.length;) {
    let run = 1;
    while (i + run < data.length && data[i + run] === data[i]) run++;
    literal(w, data[i]);
    let left = run - 1;
    while (left >= 3) {
      let len = Math.min(left, 258);
      if (left - len > 0 && left - len < 3) len = left - 3;
      match(w, len);
      left -= len;
    }
    for (; left > 0; left--) literal(w, data[i]);
    i += run;
  }
  literal(w, 256); // end of block
  return [0x78, 0x01, ...w.done(), ...u32(adler32(data))];
}

// Pixel (x, y) is foreground when it falls inside a "#" cell of the glyph.
function scanlines(size, share) {
  const cell = Math.max(1, Math.floor((size * share) / 7));
  const span = cell * 7;
  const off = Math.floor((size - span) / 2);
  const stride = Math.ceil(size / 8);
  const raw = new Uint8Array((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    const row = y * (stride + 1);
    raw[row] = 0; // filter: none
    const gy = Math.floor((y - off) / cell);
    for (let x = 0; x < size; x++) {
      const gx = Math.floor((x - off) / cell);
      const on = y >= off && x >= off && gy < 7 && gx < 7 && GLYPH[gy][gx] === "#";
      if (on) raw[row + 1 + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return raw;
}

function png(size, share) {
  const raw = scanlines(size, share);
  const ihdr = [...u32(size), ...u32(size), 1, 3, 0, 0, 0]; // bit depth 1, palette, deflate, adaptive, no interlace
  const idat = deflate(raw);
  const bytes = Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...chunk("IHDR", ihdr), ...chunk("PLTE", [...ICON_BG, ...FG]), ...chunk("IDAT", idat), ...chunk("IEND", []),
  ]);
  const back = inflateSync(Buffer.from(idat));
  if (Buffer.compare(back, Buffer.from(raw)) !== 0) throw new Error(`icon ${size}: deflate check failed`);
  return bytes;
}

function build() {
  const lines = [];
  for (const [name, size, share] of ICONS) {
    const bytes = png(size, share);
    const sha8 = createHash("sha256").update(bytes).digest("hex").slice(0, 8);
    lines.push(`  ${JSON.stringify(name)}: { size: ${size}, sha8: ${JSON.stringify(sha8)}, b64: ${JSON.stringify(Buffer.from(bytes).toString("base64"))} },`);
  }
  const hex = ICON_BG.map((v) => v.toString(16).padStart(2, "0")).join("");
  return `// GENERATED by scripts/gen-portal-icons.mjs — do not edit by hand.
// The portal's home-screen icons (PNG, base64) and the first 8 hex of each one's SHA-256 (for ?v=).
export const ICON_COLOR = "#${hex}";
export const ICONS = Object.freeze({
${lines.join("\n")}
});
`;
}

const text = build();
if (process.argv.includes("--check")) {
  const now = existsSync(OUT) ? readFileSync(OUT, "utf8") : "";
  if (now.replace(/\r\n/g, "\n") !== text) {
    console.error("worker/src/portal-icons.generated.js is out of date: run node scripts/gen-portal-icons.mjs");
    process.exit(1);
  }
  console.log("portal icons up to date");
} else {
  writeFileSync(OUT, text);
  for (const [name] of ICONS) {
    const b64 = text.match(new RegExp(`"${name.replace(".", "\\.")}": \\{[^}]*b64: "([^"]+)"`))[1];
    console.log(`${name}: ${Buffer.from(b64, "base64").length} bytes`);
  }
}
