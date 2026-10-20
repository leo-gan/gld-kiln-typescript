/** Compiled encode/decode for structs made of scalars and strings. */

import { fitInt, readF32, readF64, readI64, readU32, readU64, writeF32, writeF64, writeI64, writeU32 } from "./binary.ts";
import { KilnError } from "./error.ts";
import type { Field, Schema } from "./schema.ts";

export interface Sink {
  buf: Uint8Array;
  end: number;
}

const utf8 = new TextEncoder();
const utf8Fatal = new TextDecoder("utf-8", { fatal: true });
const utf8Loose = new TextDecoder("utf-8", { fatal: false });

const FIXED: Record<string, number> = {
  bool: 1,
  i8: 1,
  u8: 1,
  i16: 2,
  u16: 2,
  i32: 4,
  u32: 4,
  f32: 4,
  i64: 8,
  u64: 8,
  int: 8,
  uint: 8,
  f64: 8,
};

function ensure(w: Sink, extra: number): void {
  const need = w.end + extra;
  if (need <= w.buf.length) {
    return;
  }
  let cap = w.buf.length * 2;
  if (cap < need) {
    cap = need;
  }
  const grown = new Uint8Array(cap);
  grown.set(w.buf.subarray(0, w.end));
  w.buf = grown;
}

export function writeStr(w: Sink, value: string, cap: number): void {
  const n = value.length;
  let ascii = true;
  for (let i = 0; i < n; i++) {
    if (value.charCodeAt(i) > 0x7f) {
      ascii = false;
      break;
    }
  }
  if (ascii) {
    if (n > cap) {
      throw new KilnError("LIMIT");
    }
    ensure(w, 4 + n);
    writeU32(w.buf, w.end, n);
    const o = w.end + 4;
    for (let i = 0; i < n; i++) {
      w.buf[o + i] = value.charCodeAt(i);
    }
    w.end = o + n;
    return;
  }
  const raw = utf8.encode(value);
  if (raw.length > cap) {
    throw new KilnError("LIMIT");
  }
  ensure(w, 4 + raw.length);
  writeU32(w.buf, w.end, raw.length);
  w.buf.set(raw, w.end + 4);
  w.end += 4 + raw.length;
}

export function readStr(buf: Uint8Array, i: number, cap: number, trusted: boolean): [string, number] {
  if (i + 4 > buf.length) {
    throw new KilnError("EOF");
  }
  const length = readU32(buf, i);
  if (length > cap) {
    throw new KilnError("LIMIT");
  }
  const start = i + 4;
  const end = start + length;
  if (end > buf.length) {
    throw new KilnError("EOF");
  }
  let ascii = true;
  for (let n = start; n < end; n++) {
    if (buf[n] > 0x7f) {
      ascii = false;
      break;
    }
  }
  if (ascii) {
    let text = "";
    for (let n = start; n < end; n++) {
      text += String.fromCharCode(buf[n]);
    }
    return [text, end];
  }
  const raw = buf.subarray(start, end);
  if (trusted) {
    return [utf8Loose.decode(raw), end];
  }
  try {
    return [utf8Fatal.decode(raw), end];
  } catch {
    throw new KilnError("UTF8");
  }
}

function store(kind: string, at: string, key: string): string {
  const v = `obj[${key}]`;
  switch (kind) {
    case "bool":
      return `b[${at}] = ${v} ? 1 : 0;`;
    case "i8":
    case "u8":
      return `b[${at}] = ${v} & 255;`;
    case "i16":
    case "u16":
      return `b[${at}] = ${v}; b[${at}+1] = ${v} >>> 8;`;
    case "i32":
    case "u32":
      return `b[${at}] = ${v}; b[${at}+1] = ${v} >>> 8; b[${at}+2] = ${v} >>> 16; b[${at}+3] = ${v} >>> 24;`;
    case "i64":
    case "int":
      return `writeI64(b, ${at}, typeof ${v} === "bigint" ? ${v} : BigInt(${v}));`;
    case "u64":
    case "uint":
      return `writeI64(b, ${at}, typeof ${v} === "bigint" ? ${v} : BigInt(${v}));`;
    case "f32":
      return `writeF32(b, ${at}, ${v});`;
    case "f64":
      return `writeF64(b, ${at}, ${v});`;
    default:
      return "";
  }
}

function load(kind: string, at: string): string {
  switch (kind) {
    case "bool":
      return `(() => { const t = b[${at}]; if (t > 1) throw typeError(); return t === 1; })()`;
    case "i8":
      return `(((b[${at}] << 24) >> 24))`;
    case "u8":
      return `b[${at}]`;
    case "i16":
      return `(((b[${at}] | (b[${at}+1] << 8)) << 16) >> 16)`;
    case "u16":
      return `(b[${at}] | (b[${at}+1] << 8))`;
    case "i32":
      return `(b[${at}] | (b[${at}+1] << 8) | (b[${at}+2] << 16) | (b[${at}+3] << 24))`;
    case "u32":
      return `((b[${at}] | (b[${at}+1] << 8) | (b[${at}+2] << 16) | (b[${at}+3] << 24)) >>> 0)`;
    case "i64":
    case "int":
      return `fitInt(readI64(b, ${at}))`;
    case "u64":
    case "uint":
      return `fitInt(readU64(b, ${at}))`;
    case "f32":
      return `readF32(b, ${at})`;
    case "f64":
      return `readF64(b, ${at})`;
    default:
      return "0";
  }
}

export function compileEncode(schema: Schema): ((w: Sink, obj: Record<string, unknown>, cap: number) => void) | null {
  if (schema[0] !== "struct") {
    return null;
  }
  const fields = schema[1] as readonly Field[];
  const parts: string[] = ["let e = w.end;", "let b = w.buf;"];
  let chunk: string[] = [];
  let chunkBytes = 0;
  const flush = () => {
    if (chunkBytes === 0) {
      return;
    }
    parts.push(`if (e + ${chunkBytes} > b.length) { w.end = e; ensure(w, ${chunkBytes}); e = w.end; b = w.buf; }`);
    parts.push(...chunk);
    chunk = [];
    chunkBytes = 0;
  };
  for (const [name, field] of fields) {
    const kind = field[0];
    const key = JSON.stringify(name);
    if (kind === "str") {
      flush();
      parts.push(`w.end = e; writeStr(w, obj[${key}], cap); e = w.end; b = w.buf;`);
      continue;
    }
    const width = FIXED[kind];
    if (!width) {
      return null;
    }
    chunk.push(store(kind, "e", key));
    chunk.push(`e += ${width};`);
    chunkBytes += width;
  }
  flush();
  parts.push("w.end = e;");
  const fn = new Function(
    "w",
    "obj",
    "cap",
    "ensure",
    "writeStr",
    "writeI64",
    "writeF32",
    "writeF64",
    `"use strict";\n${parts.join("\n")}`,
  );
  return (w, obj, cap) => fn(w, obj, cap, ensure, writeStr, writeI64, writeF32, writeF64);
}

export function compileDecode(
  schema: Schema,
): ((buf: Uint8Array, cap: number, trusted: boolean) => [Record<string, unknown>, number]) | null {
  if (schema[0] !== "struct") {
    return null;
  }
  const fields = schema[1] as readonly Field[];
  const parts: string[] = ["const b = buf;", "const out = {};", "let o = 0;"];
  for (const [name, field] of fields) {
    const kind = field[0];
    const key = JSON.stringify(name);
    if (kind === "str") {
      parts.push(`{ const pair = readStr(b, o, cap, trusted); out[${key}] = pair[0]; o = pair[1]; }`);
      continue;
    }
    const width = FIXED[kind];
    if (!width) {
      return null;
    }
    parts.push(`if (o + ${width} > b.length) throw eof();`);
    parts.push(`out[${key}] = ${load(kind, "o")};`);
    parts.push(`o += ${width};`);
  }
  parts.push("return [out, o];");
  const fn = new Function(
    "buf",
    "cap",
    "trusted",
    "readStr",
    "eof",
    "typeError",
    "fitInt",
    "readI64",
    "readU64",
    "readF32",
    "readF64",
    `"use strict";\n${parts.join("\n")}`,
  );
  const eof = () => new KilnError("EOF");
  const typeError = () => new KilnError("TYPE");
  return (buf, cap, trusted) =>
    fn(buf, cap, trusted, readStr, eof, typeError, fitInt, readI64, readU64, readF32, readF64);
}
