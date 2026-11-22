// Best-effort text of a PDF (investor decks, shareholder letters, stats sheets)
// so the grader reads a deck instead of its title. No dependencies: it scans
// the file's objects (object streams included), inflates FlateDecode streams
// with the Workers DecompressionStream("deflate"), walks the page tree and reads
// the text-showing operators (Tj, TJ, ' and ") of each page's content and its
// form XObjects. Strings are decoded through the font's ToUnicode CMap, else a
// simple font's WinAnsi / MacRoman / Standard encoding and /Differences; what
// cannot be decoded (a composite font without ToUnicode, an encrypted file) is
// skipped. Words are spaced and lines broken from glyph positions (font
// widths, text and graphics matrices), as a viewer lays them out.
//
// The input is one or more byte segments of the file: the whole file, or the
// head and the tail of a large one (the download is bounded; the tail holds the
// fonts and the page tree of many generators). A cut-off object is read as far
// as it goes.
//
// Work is bounded: only page contents, forms, CMaps and object streams are ever
// inflated (never images or font programs), with caps on inflated bytes, pages,
// content characters and output characters.

const DEFAULTS = {
  maxInflatedBytes: 32_000_000,  // all streams inflated for one file
  maxStreamBytes: 6_000_000,     // one inflated stream
  maxContentChars: 8_000_000,    // content-stream characters tokenized
  maxPages: 80,
  maxChars: 120_000,             // text kept for the excerpt picker
  maxFormDepth: 2,
};
// More unmapped glyph codes than this share of all shown codes: unreadable.
const MAX_MISSING_SHARE = 0.1;

// --- Bytes and streams ---------------------------------------------------------
// A one-byte string with the file's bytes (index i = byte i).
function latin1(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return s;
}

async function inflate(bytes, limit) {
  const ds = new DecompressionStream("deflate");
  const writer = ds.writable.getWriter();
  writer.write(bytes).catch(() => {});
  writer.close().catch(() => {});
  const reader = ds.readable.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.length;
      if (size >= limit) { reader.cancel().catch(() => {}); break; }
    }
  } catch { /* truncated or trailing bytes: keep what came out */ }
  const out = new Uint8Array(Math.min(size, limit));
  let off = 0;
  for (const c of chunks) {
    if (off >= out.length) break;
    const part = c.subarray(0, out.length - off);
    out.set(part, off);
    off += part.length;
  }
  return out;
}

// --- Object syntax -------------------------------------------------------------
// Values: numbers, booleans, null, names as "/Name" strings, { ref: n },
// { str: "<one-byte string>" }, arrays and dictionaries ({ dict: { Name: v } }).
const WS = new Set([0, 9, 10, 12, 13, 32]);
const DELIM = new Set([40, 41, 60, 62, 91, 93, 123, 125, 47, 37]);
const isWs = (c) => WS.has(c);
const isRegular = (c) => !WS.has(c) && !DELIM.has(c) && !Number.isNaN(c);

function skipWs(s, i) {
  for (;;) {
    while (i < s.length && isWs(s.charCodeAt(i))) i++;
    if (s.charCodeAt(i) !== 37) return i;   // % comment
    while (i < s.length && s[i] !== "\n" && s[i] !== "\r") i++;
  }
}

// A literal string "( ... )" starting at i (the "("). Returns [string, end].
function readLiteral(s, i) {
  let depth = 1, out = "";
  i++;
  while (i < s.length) {
    const c = s[i];
    if (c === "\\") {
      const n = s[i + 1];
      i += 2;
      switch (n) {
        case "n": out += "\n"; break;
        case "r": out += "\r"; break;
        case "t": out += "\t"; break;
        case "b": out += "\b"; break;
        case "f": out += "\f"; break;
        case "\r": if (s[i] === "\n") i++; break;   // line continuation
        case "\n": break;
        default:
          if (n >= "0" && n <= "7") {
            let oct = n;
            while (oct.length < 3 && s[i] >= "0" && s[i] <= "7") oct += s[i++];
            out += String.fromCharCode(parseInt(oct, 8) & 0xff);
          } else if (n !== undefined) out += n;
      }
      continue;
    }
    if (c === "(") depth++;
    else if (c === ")" && --depth === 0) return [out, i + 1];
    out += c;
    i++;
  }
  return [out, i];
}

function readHex(s, i) {
  const end = s.indexOf(">", i + 1);
  const stop = end === -1 ? s.length : end;
  const hex = s.slice(i + 1, stop).replace(/[^0-9a-fA-F]/g, "");
  let out = "";
  for (let k = 0; k < hex.length; k += 2) out += String.fromCharCode(parseInt(hex.slice(k, k + 2).padEnd(2, "0"), 16));
  return [out, stop + 1];
}

function readName(s, i) {
  let j = i + 1;
  while (j < s.length && isRegular(s.charCodeAt(j))) j++;
  const raw = s.slice(i + 1, j);
  return ["/" + (raw.includes("#") ? raw.replace(/#([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))) : raw), j];
}

const NUM_RE = /[+-]?(?:\d+\.?\d*|\.\d+)/y;
const REF_RE = /\s+(\d+)\s+R(?![A-Za-z0-9])/y;

// One value at i. Returns [value, end]; [undefined, i] at an unknown token.
function parseValue(s, i, depth = 0) {
  i = skipWs(s, i);
  if (i >= s.length || depth > 40) return [undefined, i];
  const c = s[i];
  if (c === "/") return readName(s, i);
  if (c === "(") { const [str, j] = readLiteral(s, i); return [{ str }, j]; }
  if (c === "<") {
    if (s[i + 1] === "<") {
      const dict = {};
      i += 2;
      for (;;) {
        i = skipWs(s, i);
        if (i >= s.length) return [{ dict }, i];
        if (s[i] === ">" && s[i + 1] === ">") return [{ dict }, i + 2];
        if (s[i] !== "/") { i++; continue; }
        const [key, j] = readName(s, i);
        const [val, k] = parseValue(s, j, depth + 1);
        dict[key.slice(1)] = val;
        i = k > j ? k : j + 1;
      }
    }
    const [str, j] = readHex(s, i);
    return [{ str }, j];
  }
  if (c === "[") {
    const arr = [];
    i++;
    for (;;) {
      i = skipWs(s, i);
      if (i >= s.length) return [arr, i];
      if (s[i] === "]") return [arr, i + 1];
      const [val, j] = parseValue(s, i, depth + 1);
      if (j <= i) { i++; continue; }
      arr.push(val);
      i = j;
    }
  }
  NUM_RE.lastIndex = i;
  const num = NUM_RE.exec(s);
  if (num) {
    let j = NUM_RE.lastIndex;
    if (/^\d+$/.test(num[0])) {
      REF_RE.lastIndex = j;
      const ref = REF_RE.exec(s);
      if (ref) return [{ ref: Number(num[0]) }, REF_RE.lastIndex];
    }
    return [Number(num[0]), j];
  }
  let j = i;
  while (j < s.length && isRegular(s.charCodeAt(j))) j++;
  const word = s.slice(i, j);
  if (word === "true") return [true, j];
  if (word === "false") return [false, j];
  if (word === "null") return [null, j];
  return [undefined, j > i ? j : i + 1];
}


// --- The document -------------------------------------------------------------
// objects: num -> { seg, text, start, end } (start/end: stream data in seg's bytes).
class PdfDoc {
  constructor(segments, opts) {
    this.segs = segments.map((bytes) => ({ bytes, s: latin1(bytes) }));
    this.opts = opts;
    this.objects = new Map();
    this.parsed = new Map();
    this.streams = new Map();
    this.inflated = 0;
    this.objStmsExpanded = false;
    this.stats = { objects: 0, pages: 0, streams: 0, codes: 0, missing: 0, undecodable: 0, truncated: false, segments: segments.length };
    this.segs.forEach((seg) => this.scan(seg));
    this.stats.objects = this.objects.size;
  }

  // Later segments (later in the file) override earlier definitions.
  scan(seg) {
    const s = seg.s;
    const re = /(\d{1,10})[ \t\r\n\f\0]+(\d{1,5})[ \t\r\n\f\0]+obj(?![A-Za-z0-9])/g;
    let m;
    while ((m = re.exec(s))) {
      const num = Number(m[1]);
      const bodyStart = re.lastIndex;
      const endobj = s.indexOf("endobj", bodyStart);
      let stream = s.indexOf("stream", bodyStart);
      while (stream !== -1 && s.slice(stream - 3, stream) === "end") stream = s.indexOf("stream", stream + 6);
      if (stream !== -1 && (endobj === -1 || stream < endobj)) {
        const text = s.slice(bodyStart, stream);
        let start = stream + 6;
        if (s[start] === "\r") start++;
        if (s[start] === "\n") start++;
        let end = -1, next = -1;
        const len = /\/Length[ \t\r\n]+(\d+)(?![ \t\r\n]+\d+[ \t\r\n]+R)/.exec(text);
        if (len) {
          const k = skipWs(s, start + Number(len[1]));
          if (s.startsWith("endstream", k)) { end = start + Number(len[1]); next = k + 9; }
        }
        if (end === -1) {
          const k = s.indexOf("endstream", start);
          if (k === -1) { end = s.length; next = s.length; this.stats.truncated = true; }
          else {
            end = k;
            while (end > start && (s[end - 1] === "\n" || s[end - 1] === "\r")) end--;
            next = k + 9;
          }
        }
        this.objects.set(num, { seg, text, start, end });
        re.lastIndex = next;
      } else {
        if (endobj === -1) this.stats.truncated = true;
        this.objects.set(num, { seg, text: s.slice(bodyStart, endobj === -1 ? s.length : endobj) });
        re.lastIndex = endobj === -1 ? s.length : endobj + 6;
      }
    }
  }

  // Objects packed in object streams (PDF 1.5+), read once on the first miss.
  async expandObjStms() {
    if (this.objStmsExpanded) return;
    this.objStmsExpanded = true;
    for (const [num, o] of [...this.objects]) {
      if (o.start == null || !/\/Type\s*\/ObjStm\b/.test(o.text)) continue;
      const dict = this.dictOf(num);
      const data = await this.streamData(num);
      if (!data || !dict) continue;
      const text = latin1(data);
      const n = Math.min(Number(dict.N) || 0, 100_000), first = Number(dict.First) || 0;
      const head = text.slice(0, first).trim().split(/\s+/).map(Number);
      for (let k = 0; k < n && 2 * k + 1 < head.length; k++) {
        const objNum = head[2 * k], off = first + head[2 * k + 1];
        const stop = 2 * k + 3 < head.length ? first + head[2 * k + 3] : text.length;
        if (!this.objects.has(objNum)) this.objects.set(objNum, { text: text.slice(off, stop) });
      }
    }
  }

  async get(num) {
    if (!this.objects.has(num)) await this.expandObjStms();
    return this.parsedValue(num);
  }

  parsedValue(num) {
    if (this.parsed.has(num)) return this.parsed.get(num);
    const o = this.objects.get(num);
    const value = o ? parseValue(o.text, 0)[0] : undefined;
    this.parsed.set(num, value);
    return value;
  }

  dictOf(num) {
    return this.parsedValue(num)?.dict || null;
  }

  async resolve(v, depth = 0) {
    while (v && typeof v === "object" && "ref" in v && depth++ < 16) v = await this.get(v.ref);
    return v;
  }

  async resolveDict(v) {
    const r = await this.resolve(v);
    return r?.dict || null;
  }

  // Decoded stream data of object num (FlateDecode or unfiltered), or null.
  async streamData(num) {
    if (this.streams.has(num)) return this.streams.get(num);
    let out = null;
    const o = this.objects.get(num);
    const dict = o?.start != null ? this.dictOf(num) : null;
    if (dict && !/^\/(?:Image|XML)$/.test(String(dict.Subtype))) {
      let end = o.end;
      const len = await this.resolve(dict.Length);
      if (Number.isInteger(len) && len >= 0 && o.start + len < end) end = o.start + len;
      const raw = o.seg.bytes.subarray(o.start, end);
      const filters = [].concat((await this.resolve(dict.Filter)) ?? []);
      const budget = Math.min(this.opts.maxStreamBytes, this.opts.maxInflatedBytes - this.inflated);
      if (budget > 0) {
        if (!filters.length) out = raw.subarray(0, budget);
        else if (filters.length === 1 && (filters[0] === "/FlateDecode" || filters[0] === "/Fl")) {
          const parms = await this.resolveDict(Array.isArray(dict.DecodeParms) ? dict.DecodeParms[0] : dict.DecodeParms);
          if (!parms || !(Number(parms.Predictor) > 1)) out = await inflate(raw, budget);
        }
      }
      if (out) { this.inflated += out.length; this.stats.streams++; }
    }
    this.streams.set(num, out);
    return out;
  }

  // Stream data for a value that refers to a stream object.
  async streamOf(v) {
    return v && typeof v === "object" && "ref" in v ? this.streamData(v.ref) : null;
  }

  encrypted() {
    for (const { s } of this.segs) {
      for (let i = s.lastIndexOf("trailer"); i !== -1; i = i > 0 ? s.lastIndexOf("trailer", i - 1) : -1) {
        if (/\/Encrypt\b/.test(s.slice(i, i + 2000))) return true;
      }
    }
    for (const o of this.objects.values()) if (o.start != null && /\/Type\s*\/XRef\b/.test(o.text) && /\/Encrypt\b/.test(o.text)) return true;
    return false;
  }

  // The catalog's object number, from the last trailer or XRef stream.
  rootRef() {
    for (let k = this.segs.length - 1; k >= 0; k--) {
      const s = this.segs[k].s;
      let last = null;
      for (const m of s.matchAll(/\/Root[ \t\r\n]+(\d+)[ \t\r\n]+\d+[ \t\r\n]+R/g)) last = Number(m[1]);
      if (last != null) return last;
    }
    return null;
  }

  // Pages in document order with their inherited resources. Pages whose
  // objects are missing (the middle of a file read as head and tail) are
  // skipped; when the page tree itself is unreadable, every /Type /Page
  // object is taken in file order.
  async pages() {
    const out = [];
    const seen = new Set();
    const walk = async (ref, inherited, depth) => {
      if (!ref || typeof ref !== "object" || !("ref" in ref) || seen.has(ref.ref) || depth > 30 || out.length >= this.opts.maxPages) return;
      seen.add(ref.ref);
      const node = await this.resolveDict(ref);
      if (!node) return;
      const resources = node.Resources ?? inherited;
      const kids = await this.resolve(node.Kids);
      if (node.Type === "/Pages" || Array.isArray(kids)) {
        for (const kid of kids || []) await walk(kid, resources, depth + 1);
      } else if (node.Type === "/Page" || node.Contents) {
        out.push({ num: ref.ref, dict: node, resources });
      }
    };
    const root = this.rootRef();
    const catalog = root != null ? await this.resolveDict({ ref: root }) : null;
    if (catalog?.Pages) await walk(catalog.Pages, null, 0);
    if (out.length) return out;
    await this.expandObjStms();
    const order = (n) => {
      const o = this.objects.get(n);
      return (o.seg ? this.segs.indexOf(o.seg) : 0) * 1e12 + (o.start ?? 0);
    };
    const nums = [...this.objects.keys()].filter((n) => /\/Type\s*\/Page(?![A-Za-z])/.test(this.objects.get(n).text));
    for (const num of nums.sort((a, b) => order(a) - order(b) || a - b)) {
      if (out.length >= this.opts.maxPages) break;
      const dict = this.dictOf(num);
      if (!dict) continue;
      let resources = dict.Resources;
      for (let p = dict.Parent, k = 0; resources == null && p && k < 10; k++) {
        const parent = await this.resolveDict(p);
        resources = parent?.Resources;
        p = parent?.Parent;
      }
      out.push({ num, dict, resources });
    }
    return out;
  }
}

// --- Fonts -----------------------------------------------------------------------
const WIN_ANSI_80 = "€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ";
const MAC_ROMAN_80 = "ÄÅÇÉÑÖÜáàâäãåçéèêëíìîïñóòôöõúùûü†°¢£§•¶ß®©™´¨≠ÆØ∞±≤≥¥µ∂∑∏π∫ªºΩæø¿¡¬√ƒ≈∆«»… ÀÃÕŒœ–—“”‘’÷◊ÿŸ⁄€‹›ﬁﬂ‡·‚„‰ÂÊÁËÈÍÎÏÌÓÔÒÚÛÙıˆ˜¯˘˙˚¸˝˛ˇ";
function baseTable(name) {
  const t = new Array(256);
  for (let c = 32; c < 127; c++) t[c] = String.fromCharCode(c);
  if (name === "/MacRomanEncoding") for (let c = 128; c < 256; c++) t[c] = MAC_ROMAN_80[c - 128];
  else if (name !== "/StandardEncoding") {
    for (let c = 128; c < 160; c++) t[c] = WIN_ANSI_80[c - 128];
    for (let c = 160; c < 256; c++) t[c] = String.fromCharCode(c);
  }
  if (name === "/StandardEncoding") { t[39] = "’"; t[96] = "‘"; }
  return t;
}

// Glyph names seen in /Differences arrays (the rest of the Adobe list is rare
// in decks); uniXXXX and single characters are read directly.
const GLYPHS = {
  space: " ", exclam: "!", quotedbl: '"', numbersign: "#", dollar: "$", percent: "%", ampersand: "&", quotesingle: "'",
  parenleft: "(", parenright: ")", asterisk: "*", plus: "+", comma: ",", hyphen: "-", period: ".", slash: "/",
  zero: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9",
  colon: ":", semicolon: ";", less: "<", equal: "=", greater: ">", question: "?", at: "@", bracketleft: "[",
  backslash: "\\", bracketright: "]", asciicircum: "^", underscore: "_", grave: "`", braceleft: "{", bar: "|",
  braceright: "}", asciitilde: "~", quoteright: "’", quoteleft: "‘", quotedblleft: "“", quotedblright: "”",
  quotesinglbase: "‚", quotedblbase: "„", endash: "–", emdash: "—", bullet: "•", ellipsis: "…", dagger: "†",
  daggerdbl: "‡", trademark: "™", registered: "®", copyright: "©", degree: "°", euro: "€", sterling: "£", yen: "¥",
  cent: "¢", section: "§", paragraph: "¶", periodcentered: "·", multiply: "×", divide: "÷", minus: "−", fi: "fi",
  fl: "fl", ff: "ff", ffi: "ffi", ffl: "ffl", nbspace: " ", sfthyphen: "", onehalf: "½", onequarter: "¼",
  threequarters: "¾", plusminus: "±", mu: "µ", eacute: "é", egrave: "è", aacute: "á", agrave: "à", oacute: "ó",
  uacute: "ú", iacute: "í", ntilde: "ñ", udieresis: "ü", odieresis: "ö", adieresis: "ä", ccedilla: "ç",
  germandbls: "ß", Eacute: "É", guillemotleft: "«", guillemotright: "»", arrowright: "→", checkmark: "✓",
};
function glyphChar(name) {
  if (GLYPHS[name] !== undefined) return GLYPHS[name];
  if (name.length === 1) return name;
  const uni = /^uni([0-9A-Fa-f]{4})/.exec(name) || /^u([0-9A-Fa-f]{4,6})$/.exec(name);
  if (uni) { const cp = parseInt(uni[1], 16); return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ""; }
  const base = name.split(/[._]/)[0];
  if (base !== name && base) return glyphChar(base);
  return null;
}

function utf16be(str) {
  let out = "";
  for (let i = 0; i + 1 < str.length; i += 2) out += String.fromCharCode((str.charCodeAt(i) << 8) | str.charCodeAt(i + 1));
  return out.length ? out : str;
}

// ToUnicode CMap: codespace byte lengths, single codes and ranges.
function parseCMap(text) {
  const map = new Map(), ranges = [], lengths = new Set();
  const hexes = (body) => [...body.matchAll(/<([0-9A-Fa-f\s]*)>|\[([^\]]*)\]/g)];
  const hexVal = (h) => h.replace(/\s+/g, "");
  const codeOf = (h) => parseInt(hexVal(h) || "0", 16);
  const strOf = (h) => utf16be(readHex("<" + hexVal(h) + ">", 0)[0]);
  for (const m of text.matchAll(/begincodespacerange([\s\S]*?)endcodespacerange/g)) {
    for (const h of hexes(m[1])) if (h[1] != null) lengths.add(Math.max(1, Math.ceil(hexVal(h[1]).length / 2)));
  }
  for (const m of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    const hs = hexes(m[1]);
    for (let k = 0; k + 1 < hs.length; k += 2) {
      if (hs[k][1] == null || hs[k + 1][1] == null) continue;
      map.set(codeOf(hs[k][1]), strOf(hs[k + 1][1]));
      if (!lengths.size) lengths.add(Math.max(1, Math.ceil(hexVal(hs[k][1]).length / 2)));
    }
  }
  for (const m of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    const hs = hexes(m[1]);
    for (let k = 0; k + 2 < hs.length; k += 3) {
      if (hs[k][1] == null || hs[k + 1][1] == null) continue;
      const lo = codeOf(hs[k][1]), hi = codeOf(hs[k + 1][1]);
      if (hi < lo || hi - lo > 0xffff) continue;
      if (!lengths.size) lengths.add(Math.max(1, Math.ceil(hexVal(hs[k][1]).length / 2)));
      if (hs[k + 2][2] != null) {
        const list = [...hs[k + 2][2].matchAll(/<([0-9A-Fa-f\s]*)>/g)].map((x) => strOf(x[1]));
        list.forEach((v, j) => { if (lo + j <= hi) map.set(lo + j, v); });
      } else if (hs[k + 2][1] != null) {
        const base = strOf(hs[k + 2][1]);
        if (hi - lo <= 512) for (let c = lo; c <= hi; c++) map.set(c, shift(base, c - lo));
        else ranges.push({ lo, hi, base });
      }
    }
  }
  return { map, ranges, lengths: [...lengths].sort((a, b) => a - b) };
}

// The destination string of a bfrange entry, its last code unit moved by d.
function shift(base, d) {
  if (!d) return base;
  const last = base.charCodeAt(base.length - 1) + d;
  return base.slice(0, -1) + String.fromCharCode(last & 0xffff);
}

function cmapLookup(cmap, code) {
  const v = cmap.map.get(code);
  if (v !== undefined) return v;
  for (const r of cmap.ranges) if (code >= r.lo && code <= r.hi) return shift(r.base, code - r.lo);
  return undefined;
}


// Glyph widths in 1/1000 em: a simple font's /FirstChar + /Widths, or a
// composite font's descendant /W and /DW. Unknown widths are estimated.
async function widthsOf(doc, font, composite) {
  const widths = new Map();
  let fallback = 500;
  if (composite) {
    const desc = await doc.resolveDict(((await doc.resolve(font.DescendantFonts)) || [])[0]);
    if (desc) {
      if (Number.isFinite(desc.DW)) fallback = desc.DW; else fallback = 1000;
      const w = (await doc.resolve(desc.W)) || [];
      for (let k = 0; k < w.length && widths.size < 65_536;) {
        const first = await doc.resolve(w[k]), next = await doc.resolve(w[k + 1]);
        if (Array.isArray(next)) {
          next.forEach((v, j) => widths.set(first + j, Number(v) || 0));
          k += 2;
        } else {
          const last = next, value = Number(await doc.resolve(w[k + 2])) || 0;
          for (let c = first; c <= last && c - first < 65_536; c++) widths.set(c, value);
          k += 3;
        }
      }
    }
  } else {
    const first = Number(await doc.resolve(font.FirstChar)) || 0;
    const list = (await doc.resolve(font.Widths)) || [];
    // A Type3 font's widths are in its own glyph space (FontMatrix), not 1/1000 em.
    const matrix = font.Subtype === "/Type3" ? await doc.resolve(font.FontMatrix) : null;
    const scale = Array.isArray(matrix) && Number(matrix[0]) > 0 ? Number(matrix[0]) * 1000 : 1;
    if (Array.isArray(list)) list.forEach((v, j) => widths.set(first + j, (Number(v) || 0) * scale));
    const descriptor = await doc.resolveDict(font.FontDescriptor);
    if (Number(descriptor?.MissingWidth) > 0) fallback = Number(descriptor.MissingWidth);
  }
  return { widths, fallback };
}

async function fontInfo(doc, ref, cache) {
  const key = ref && typeof ref === "object" && "ref" in ref ? ref.ref : null;
  if (key != null && cache.has(key)) return cache.get(key);
  const font = await doc.resolveDict(ref);
  let info = { twoByte: false, cmap: null, table: baseTable("/WinAnsiEncoding"), widths: new Map(), fallback: 500 };
  if (font) {
    const composite = font.Subtype === "/Type0";
    let cmap = null;
    if (font.ToUnicode) {
      const data = await doc.streamOf(font.ToUnicode);
      if (data) cmap = parseCMap(latin1(data));
      if (cmap && !cmap.map.size && !cmap.ranges.length) cmap = null;
    }
    let table = null;
    if (!composite) {
      const enc = await doc.resolve(font.Encoding);
      const encDict = enc?.dict || null;
      table = baseTable(typeof enc === "string" ? enc : encDict?.BaseEncoding || "/WinAnsiEncoding");
      const diffs = encDict ? await doc.resolve(encDict.Differences) : null;
      if (Array.isArray(diffs)) {
        let code = 0;
        for (const d of diffs) {
          if (typeof d === "number") code = d;
          else if (typeof d === "string" && code < 256) {
            const ch = glyphChar(d.slice(1));
            table[code++] = ch == null ? undefined : ch;
          }
        }
      }
    }
    info = { twoByte: composite, cmap, table, ...(await widthsOf(doc, font, composite)) };
  }
  if (key != null) cache.set(key, info);
  return info;
}

// One shown string: { text, width (sum of glyph widths, 1/1000 em), codes,
// spaces (single-byte code 32) }. text is null when most codes have no mapping.
function decodeShown(str, font, stats) {
  if (!font) return { text: str.replace(/[^\x20-\x7e]/g, ""), width: str.length * 500, codes: str.length, spaces: 0 };
  const { cmap, table, twoByte, widths, fallback } = font;
  let out = "", missing = 0, codes = 0, width = 0, spaces = 0;
  // A simple font's codes are one byte whatever its CMap's codespace says
  // (some writers declare <0000> <FFFF> for a WinAnsi font).
  const lens = !twoByte ? [1] : cmap?.lengths.length ? cmap.lengths : [2];
  for (let i = 0; i < str.length;) {
    codes++;
    let hit, code = 0, used = 0;
    if (cmap) {
      for (const len of lens) {
        if (i + len > str.length) break;
        code = 0;
        for (let k = 0; k < len; k++) code = code * 256 + str.charCodeAt(i + k);
        hit = cmapLookup(cmap, code);
        if (hit !== undefined) { used = len; break; }
      }
    }
    if (hit === undefined) {
      used = twoByte ? 2 : lens[0];
      code = 0;
      for (let k = 0; k < used && i + k < str.length; k++) code = code * 256 + str.charCodeAt(i + k);
      if (!twoByte && table) hit = table[code];
    }
    if (used === 1 && code === 32) spaces++;
    width += widths.get(code) ?? fallback;
    if (hit === undefined) missing++;
    else out += hit;
    i += used;
  }
  stats.codes += codes;
  stats.missing += twoByte && !cmap ? codes : missing;
  if (twoByte && !cmap) { stats.undecodable++; return { text: null, width, codes, spaces }; }
  if (codes && missing * 2 >= codes) { stats.undecodable++; return { text: null, width, codes, spaces }; }
  return { text: out, width, codes, spaces };
}

// --- Content streams ------------------------------------------------------------
const OPERATOR_END = (c) => isWs(c) || DELIM.has(c) || Number.isNaN(c);
const IDENTITY = [1, 0, 0, 1, 0, 0];
const mul = (m, n) => [
  m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5],
];
const nums = (stack, n) => {
  const out = stack.slice(-n).map(Number);
  return out.length === n && out.every(Number.isFinite) ? out : null;
};

// Appends the text of one content stream to state.out. Lines break where the
// baseline moves; a space goes where the next glyph starts more than about a
// fifth of an em after the previous one ends.
async function contentText(doc, content, resources, state, ctm0, depth) {
  const res = (await doc.resolveDict(resources)) || {};
  const fontDict = (await doc.resolveDict(res.Font)) || {};
  const xobjects = (await doc.resolveDict(res.XObject)) || {};
  const s = content;
  const stack = [], marks = [], gstack = [];
  let ctm = ctm0, tm = IDENTITY, tlm = IDENTITY;
  let font = null, fs = 0, tc = 0, tw = 0, th = 1, tl = 0;
  const out = state.out;
  const show = (v) => {
    if (!v || typeof v.str !== "string") return;
    const d = decodeShown(v.str, font, doc.stats);
    const m = mul(tm, ctm);
    const x = m[4], y = m[5];
    const size = Math.abs(fs) * (Math.hypot(m[2], m[3]) || 1);
    const em = Math.abs(fs) * (Math.hypot(m[0], m[1]) || 1);
    const last = state.last;
    if (d.text) {
      if (last && out.length) {
        const lineGap = Math.max(size, last.size) * 0.5;
        if (Math.abs(y - last.y) > lineGap) { if (out[out.length - 1] !== "\n") out.push("\n"); }
        else {
          const gap = x - last.endX;
          if ((gap > 0.2 * Math.max(em, 1e-6) || gap < -1.5 * Math.max(em, last.em)) && !/\s$/.test(out[out.length - 1]) && !/^\s/.test(d.text)) out.push(" ");
        }
      }
      const clean = d.text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffd]/g, "");
      out.push(clean);
      state.chars += clean.length;
    }
    const advance = ((d.width / 1000) * fs + d.codes * tc + d.spaces * tw) * th;
    tm = mul([1, 0, 0, 1, advance, 0], tm);
    if (d.text) {
      const e = mul(tm, ctm);
      state.last = { y, endX: e[4], size, em };
    }
  };
  const moveText = (tx, ty) => { tlm = mul([1, 0, 0, 1, tx, ty], tlm); tm = tlm; };
  let i = 0;
  while (i < s.length && state.chars <= doc.opts.maxChars) {
    const c = s.charCodeAt(i);
    if (isWs(c)) { i++; continue; }
    if (c === 37) { while (i < s.length && s[i] !== "\n" && s[i] !== "\r") i++; continue; }
    if (c === 91) { marks.push(stack.length); i++; continue; }
    if (c === 93) { const at = marks.length ? marks.pop() : 0; stack.push(stack.splice(at)); i++; continue; }
    if (c === 40) { const [str, j] = readLiteral(s, i); stack.push({ str }); i = j; continue; }
    if (c === 60) {
      if (s[i + 1] === "<") { const [, j] = parseValue(s, i); stack.push(null); i = j > i ? j : i + 2; continue; }
      const [str, j] = readHex(s, i); stack.push({ str }); i = j; continue;
    }
    if (c === 47) { const [name, j] = readName(s, i); stack.push(name); i = j; continue; }
    if ((c >= 48 && c <= 57) || c === 43 || c === 45 || c === 46) {
      NUM_RE.lastIndex = i;
      const m = NUM_RE.exec(s);
      if (m) { stack.push(Number(m[0])); i = NUM_RE.lastIndex; continue; }
      i++;
      continue;
    }
    let j = i;
    while (j < s.length && !OPERATOR_END(s.charCodeAt(j))) j++;
    if (j === i) { i++; continue; }
    const op = s.slice(i, j);
    i = j;
    switch (op) {
      case "q": if (gstack.length < 64) gstack.push(ctm); break;
      case "Q": if (gstack.length) ctm = gstack.pop(); break;
      case "cm": { const m = nums(stack, 6); if (m) ctm = mul(m, ctm); break; }
      case "BT": tm = tlm = IDENTITY; break;
      case "Tf": {
        fs = Number(stack[stack.length - 1]) || 0;
        font = await fontInfo(doc, fontDict[String(stack[stack.length - 2] || "").slice(1)], state.fonts);
        break;
      }
      case "Tc": tc = Number(stack[stack.length - 1]) || 0; break;
      case "Tw": tw = Number(stack[stack.length - 1]) || 0; break;
      case "Tz": th = (Number(stack[stack.length - 1]) || 100) / 100; break;
      case "TL": tl = Number(stack[stack.length - 1]) || 0; break;
      case "Td": { const m = nums(stack, 2); if (m) moveText(m[0], m[1]); break; }
      case "TD": { const m = nums(stack, 2); if (m) { tl = -m[1]; moveText(m[0], m[1]); } break; }
      case "Tm": { const m = nums(stack, 6); if (m) tm = tlm = m; break; }
      case "T*": moveText(0, -tl); break;
      case "Tj": show(stack[stack.length - 1]); break;
      case "'": moveText(0, -tl); show(stack[stack.length - 1]); break;
      case '"': {
        tw = Number(stack[stack.length - 3]) || 0; tc = Number(stack[stack.length - 2]) || 0;
        moveText(0, -tl); show(stack[stack.length - 1]); break;
      }
      case "TJ": {
        const arr = stack[stack.length - 1];
        if (!Array.isArray(arr)) break;
        for (const v of arr) {
          if (typeof v === "number") tm = mul([1, 0, 0, 1, (-v / 1000) * fs * th, 0], tm);
          else show(v);
        }
        break;
      }
      case "Do": {
        const ref = xobjects[String(stack[stack.length - 1] || "").slice(1)];
        const key = ref?.ref;
        if (depth >= doc.opts.maxFormDepth || key == null || state.forms.has(key) || state.forms.size >= 200) break;
        state.forms.add(key);
        const form = doc.dictOf(key);
        if (form?.Subtype !== "/Form") break;
        const data = await doc.streamData(key);
        if (!data || (state.content += data.length) > doc.opts.maxContentChars) break;
        const matrix = (await doc.resolve(form.Matrix)) || IDENTITY;
        await contentText(doc, latin1(data), form.Resources ?? resources,
          state, mul(matrix.length === 6 ? matrix.map(Number) : IDENTITY, ctm), depth + 1);
        break;
      }
      case "BI": {                                     // inline image: skip to EI
        const id = s.indexOf("ID", i);
        const ei = id === -1 ? -1 : s.slice(id + 2, id + 2 + 2_000_000).search(/[\s\0]EI(?![A-Za-z0-9])/);
        i = ei === -1 ? s.length : id + 2 + ei + 3;
        break;
      }
      default: break;
    }
    stack.length = 0;
    marks.length = 0;
  }
}

// Plain text of each page from one or more byte segments of a PDF:
// { status: "ok" | "encrypted" | "no_text" | "not_pdf", pages, stats }.
export async function pdfText(input, options = {}) {
  const opts = { ...DEFAULTS, ...options };
  const segments = (Array.isArray(input) ? input : [input])
    .filter(Boolean).map((b) => (b instanceof Uint8Array ? b : new Uint8Array(b)));
  if (!segments.length || !latin1(segments[0].subarray(0, 1024)).includes("%PDF-")) return { status: "not_pdf", pages: [], stats: {} };
  const doc = new PdfDoc(segments, opts);
  if (doc.encrypted()) return { status: "encrypted", pages: [], stats: doc.stats };
  const pages = [];
  const state = { chars: 0, content: 0, fonts: new Map(), forms: new Set(), out: null, last: null };
  for (const page of await doc.pages()) {
    if (state.chars > opts.maxChars || state.content > opts.maxContentChars) break;
    const contents = await doc.resolve(page.dict.Contents);
    const parts = Array.isArray(contents) ? contents : [page.dict.Contents];
    let content = "";
    for (const part of parts) {
      const d = await doc.streamOf(part);
      if (d) content += latin1(d) + "\n";
    }
    if (!content) continue;
    state.content += content.length;
    state.out = [];
    state.forms = new Set();
    state.last = null;
    await contentText(doc, content, page.resources, state, IDENTITY, 0);
    pages.push(tidy(state.out.join("")));
  }
  doc.stats.pages = pages.length;
  // Text with many glyphs that had no mapping reads as fragments ("rev e e"):
  // not worth an excerpt.
  const { codes, missing } = doc.stats;
  const mostlyMapped = !codes || missing / codes <= MAX_MISSING_SHARE;
  return { status: mostlyMapped && readable(pages.join("\n")) ? "ok" : "no_text", pages, stats: doc.stats };
}

function tidy(text) {
  return text
    .replace(/[ \t\u00a0\u2000-\u200b\u202f\u3000]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

// Enough text, and mostly letters, digits, spaces and ordinary punctuation:
// a font without a usable mapping produces symbol soup instead.
export function readable(text) {
  const t = String(text || "");
  if (t.replace(/\s+/g, "").length < 120) return false;
  if ((t.match(/\p{L}{2,}/gu) || []).length < 15) return false;
  const good = (t.match(/[\p{L}\p{N}\s.,;:!?'"’‘“”()%$€£&\-–—/•+]/gu) || []).length;
  return good / t.length >= 0.85;
}
