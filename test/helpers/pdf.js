// Test-only PDF builder: synthesized files that exercise the structures real
// covered decks use (FlateDecode content, Type0 Identity-H fonts with ToUnicode
// CMaps and /W widths, WinAnsi TrueType fonts with /Differences, object
// streams with an XRef stream, form XObjects, TJ kerning). Byte offsets in the
// xref table are not computed: the reader scans objects, as it must for files
// cut short by the download bound.
import { deflateSync } from "node:zlib";

const bin = (s) => Buffer.from(s, "latin1");

// objects: [{ num, dict: "<< ... >>" | "123", stream?: string | Buffer, flate?: true }]
export function buildPdf(objects, { root = 1, trailerExtra = "", xrefStream = false, version = "1.7" } = {}) {
  const parts = [bin(`%PDF-${version}\n%\xe2\xe3\xcf\xd3\n`)];
  for (const o of objects) {
    if (o.stream == null) { parts.push(bin(`${o.num} 0 obj\n${o.dict}\nendobj\n`)); continue; }
    let data = Buffer.isBuffer(o.stream) ? o.stream : bin(o.stream);
    if (o.flate) data = deflateSync(data);
    const dict = o.dict.replace(/>>\s*$/, `${o.flate ? " /Filter /FlateDecode" : ""} /Length ${data.length} >>`);
    parts.push(bin(`${o.num} 0 obj\n${dict}\nstream\n`), data, bin("\nendstream\nendobj\n"));
  }
  if (xrefStream) {
    const n = Math.max(...objects.map((o) => o.num)) + 1;
    parts.push(bin(`${n} 0 obj\n<< /Type /XRef /Size ${n + 1} /Root ${root} 0 R ${trailerExtra} /W [1 1 1] /Length 0 >>\nstream\n\nendstream\nendobj\n`));
  } else {
    parts.push(bin(`xref\n0 1\n0000000000 65535 f \ntrailer\n<< /Size ${objects.length + 1} /Root ${root} 0 R ${trailerExtra} >>\n`));
  }
  parts.push(bin("startxref\n0\n%%EOF\n"));
  return new Uint8Array(Buffer.concat(parts));
}

// An object stream holding non-stream objects: [{ num, dict }].
export function objStm(num, members) {
  let offsets = "", body = "", off = 0;
  for (const m of members) {
    offsets += `${m.num} ${off} `;
    body += m.dict + "\n";
    off = body.length;
  }
  return { num, dict: `<< /Type /ObjStm /N ${members.length} /First ${offsets.length} >>`, stream: offsets + body, flate: true };
}

// UTF-16BE hex of a string, for CMap destinations.
export const hex16 = (s) => [...s].map((c) => c.charCodeAt(0).toString(16).padStart(4, "0")).join("");

// A ToUnicode CMap mapping 2-byte glyph ids 1..n to the characters of `alphabet`
// (one bfrange for the first half, bfchar entries for the rest).
export function toUnicodeCMap(alphabet) {
  const chars = [...alphabet];
  const half = Math.floor(chars.length / 2);
  const code = (i) => (i + 1).toString(16).padStart(4, "0");
  let ranges = "", singles = "";
  // consecutive ranges need consecutive code points; split where they are not
  for (let i = 0; i < half;) {
    let j = i;
    while (j + 1 < half && chars[j + 1].charCodeAt(0) === chars[j].charCodeAt(0) + 1) j++;
    ranges += `<${code(i)}> <${code(j)}> <${hex16(chars[i])}>\n`;
    i = j + 1;
  }
  for (let i = half; i < chars.length; i++) singles += `<${code(i)}> <${hex16(chars[i])}>\n`;
  const nRanges = ranges.trim().split("\n").filter(Boolean).length;
  const nSingles = singles.trim().split("\n").filter(Boolean).length;
  return `/CIDInit /ProcSet findresource begin
12 dict begin
begincmap
/CMapName /Adobe-Identity-UCS def
1 begincodespacerange
<0000> <FFFF>
endcodespacerange
${nRanges} beginbfrange
${ranges}endbfrange
${nSingles} beginbfchar
${singles}endbfchar
endcmap
CMapName currentdict /CMap defineresource pop
end
end`;
}

// Hex glyph ids for text in a font built by toUnicodeCMap(alphabet).
export function glyphHex(alphabet, text) {
  const chars = [...alphabet];
  return [...text].map((c) => {
    const i = chars.indexOf(c);
    if (i < 0) throw new Error(`glyph ${c} not in alphabet`);
    return (i + 1).toString(16).padStart(4, "0");
  }).join("");
}

// A plain one-font PDF: each page is a list of lines (Helvetica, WinAnsi).
export function simplePdf(pages, { extraObjects = [], trailerExtra = "" } = {}) {
  const objects = [{ num: 1, dict: "<< /Type /Catalog /Pages 2 0 R >>" }];
  const kids = pages.map((_, k) => `${10 + 2 * k} 0 R`).join(" ");
  objects.push({ num: 2, dict: `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} /Resources << /Font << /F1 3 0 R >> >> >>` });
  objects.push({ num: 3, dict: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>" });
  pages.forEach((lines, k) => {
    const content = "BT /F1 12 Tf 72 720 Td 14 TL\n" +
      lines.map((l) => `(${l.replace(/[\\()]/g, (c) => "\\" + c)}) Tj T*`).join("\n") + "\nET";
    objects.push({ num: 10 + 2 * k, dict: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${11 + 2 * k} 0 R >>` });
    objects.push({ num: 11 + 2 * k, dict: "<< >>", stream: content, flate: true });
  });
  return buildPdf([...objects, ...extraObjects], { trailerExtra });
}
