/** Compiled encode/decode for schemas built from scalars, strings, bytes, opts, lists, and structs. */

import {
  readF32,
  readF64,
  readI64Fit,
  readU32,
  readU64Fit,
  writeF32,
  writeF64,
  writeI64Fast,
  writeU32,
  writeU64Fast,
} from "./binary.ts";
import { KilnError } from "./error.ts";
import type { Field, Schema } from "./schema.ts";

export interface Sink {
  buf: Uint8Array;
  dv: DataView;
  end: number;
}

interface NodeBuf extends Uint8Array {
  utf8Write?(str: string, offset: number): number;
  latin1Slice?(start: number, end: number): string;
}

const HAS_BUFFER = typeof Buffer !== "undefined";
const HAS_UTF8_WRITE = HAS_BUFFER && typeof (Buffer.prototype as unknown as NodeBuf).utf8Write === "function";
const HAS_LATIN1 = HAS_BUFFER && typeof (Buffer.prototype as unknown as NodeBuf).latin1Slice === "function";
const IS_LE = new Uint16Array(new Uint8Array([1, 0]).buffer)[0] === 1;

const utf8 = new TextEncoder();
const utf8Fatal = new TextDecoder("utf-8", { fatal: true });
const utf8Loose = new TextDecoder("utf-8", { fatal: false });
const fcc = String.fromCharCode;

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

export function allocBuf(size: number): Uint8Array {
  return HAS_BUFFER ? Buffer.allocUnsafe(size) : new Uint8Array(size);
}

export function asFastBuf(buf: Uint8Array): Uint8Array {
  if (!HAS_BUFFER || Buffer.isBuffer(buf)) {
    return buf;
  }
  return Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
}

export function ensure(w: Sink, extra: number): void {
  const need = w.end + extra;
  if (need <= w.buf.length) {
    return;
  }
  let cap = w.buf.length * 2;
  if (cap < need) {
    cap = need;
  }
  const grown = allocBuf(cap);
  grown.set(w.buf.subarray(0, w.end));
  w.buf = grown;
  w.dv = new DataView(grown.buffer, grown.byteOffset, grown.byteLength);
}

export function writeStr(w: Sink, value: string, cap: number): void {
  const n = value.length;
  if (n === 0) {
    ensure(w, 4);
    writeU32(w.buf, w.end, 0);
    w.end += 4;
    return;
  }
  if (n > cap) {
    throw new KilnError("LIMIT");
  }
  if (n < 36 || !HAS_UTF8_WRITE) {
    ensure(w, 4 + n);
    const b = w.buf;
    const o = w.end + 4;
    let ascii = true;
    for (let i = 0; i < n; i++) {
      const c = value.charCodeAt(i);
      if (c > 0x7f) {
        ascii = false;
        break;
      }
      b[o + i] = c;
    }
    if (ascii) {
      writeU32(b, w.end, n);
      w.end = o + n;
      return;
    }
  }
  if (HAS_UTF8_WRITE) {
    ensure(w, 4 + n * 3);
    const b = w.buf as NodeBuf;
    const written = b.utf8Write!(value, w.end + 4);
    if (written > cap) {
      throw new KilnError("LIMIT");
    }
    writeU32(b, w.end, written);
    w.end += 4 + written;
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

function shortAscii(b: Uint8Array, o: number, len: number): string {
  switch (len) {
    case 1:
      return fcc(b[o]);
    case 2:
      return fcc(b[o], b[o + 1]);
    case 3:
      return fcc(b[o], b[o + 1], b[o + 2]);
    case 4:
      return fcc(b[o], b[o + 1], b[o + 2], b[o + 3]);
    case 5:
      return fcc(b[o], b[o + 1], b[o + 2], b[o + 3], b[o + 4]);
    case 6:
      return fcc(b[o], b[o + 1], b[o + 2], b[o + 3], b[o + 4], b[o + 5]);
    case 7:
      return fcc(b[o], b[o + 1], b[o + 2], b[o + 3], b[o + 4], b[o + 5], b[o + 6]);
    case 8:
      return fcc(b[o], b[o + 1], b[o + 2], b[o + 3], b[o + 4], b[o + 5], b[o + 6], b[o + 7]);
    case 9:
      return fcc(b[o], b[o + 1], b[o + 2], b[o + 3], b[o + 4], b[o + 5], b[o + 6], b[o + 7], b[o + 8]);
    case 10:
      return fcc(b[o], b[o + 1], b[o + 2], b[o + 3], b[o + 4], b[o + 5], b[o + 6], b[o + 7], b[o + 8], b[o + 9]);
    case 11:
      return fcc(
        b[o], b[o + 1], b[o + 2], b[o + 3], b[o + 4], b[o + 5],
        b[o + 6], b[o + 7], b[o + 8], b[o + 9], b[o + 10],
      );
    case 12:
      return fcc(
        b[o], b[o + 1], b[o + 2], b[o + 3], b[o + 4], b[o + 5],
        b[o + 6], b[o + 7], b[o + 8], b[o + 9], b[o + 10], b[o + 11],
      );
    case 13:
      return fcc(
        b[o], b[o + 1], b[o + 2], b[o + 3], b[o + 4], b[o + 5],
        b[o + 6], b[o + 7], b[o + 8], b[o + 9], b[o + 10], b[o + 11], b[o + 12],
      );
    case 14:
      return fcc(
        b[o], b[o + 1], b[o + 2], b[o + 3], b[o + 4], b[o + 5],
        b[o + 6], b[o + 7], b[o + 8], b[o + 9], b[o + 10], b[o + 11], b[o + 12], b[o + 13],
      );
    case 15:
      return fcc(
        b[o], b[o + 1], b[o + 2], b[o + 3], b[o + 4], b[o + 5],
        b[o + 6], b[o + 7], b[o + 8], b[o + 9], b[o + 10], b[o + 11], b[o + 12], b[o + 13], b[o + 14],
      );
    default:
      return fcc(
        b[o], b[o + 1], b[o + 2], b[o + 3], b[o + 4], b[o + 5],
        b[o + 6], b[o + 7], b[o + 8], b[o + 9], b[o + 10], b[o + 11], b[o + 12], b[o + 13], b[o + 14], b[o + 15],
      );
  }
}

function asciiChunks(buf: Uint8Array, start: number, end: number): string {
  let out = "";
  for (let p = start; p < end; p += 4096) {
    const stop = p + 4096 < end ? p + 4096 : end;
    const chunk = buf.subarray(p, stop);
    out += fcc.apply(null, chunk as unknown as number[]);
  }
  return out;
}

export function decodeStrSlice(buf: Uint8Array, start: number, end: number, trusted: boolean): string {
  const len = end - start;
  let bits = 0;
  let p = start;
  const end4 = end - 3;
  while (p < end4) {
    bits |= buf[p] | buf[p + 1] | buf[p + 2] | buf[p + 3];
    p += 4;
  }
  while (p < end) {
    bits |= buf[p++];
  }
  if ((bits & 0x80) === 0) {
    if (len <= 16) {
      return shortAscii(buf, start, len);
    }
    if (HAS_LATIN1 && typeof (buf as NodeBuf).latin1Slice === "function") {
      return (buf as NodeBuf).latin1Slice!(start, end);
    }
    return asciiChunks(buf, start, end);
  }
  const raw = buf.subarray(start, end);
  if (trusted) {
    return utf8Loose.decode(raw);
  }
  try {
    return utf8Fatal.decode(raw);
  } catch {
    throw new KilnError("UTF8");
  }
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
  if (length === 0) {
    return ["", end];
  }
  return [decodeStrSlice(buf, start, end, trusted), end];
}

function schemaMinSize(schema: Schema): number {
  const kind = schema[0];
  const width = FIXED[kind];
  if (width !== undefined) {
    return width;
  }
  if (kind === "str" || kind === "bytes" || kind === "list") {
    return 4;
  }
  if (kind === "opt") {
    return 1;
  }
  if (kind === "struct") {
    let total = 0;
    for (const [, field] of schema[1] as readonly Field[]) {
      total += schemaMinSize(field);
    }
    return total;
  }
  return -1;
}

function canCompile(schema: Schema, depth: number): boolean {
  if (depth > 64) {
    return false;
  }
  const kind = schema[0];
  if (FIXED[kind] !== undefined || kind === "str" || kind === "bytes") {
    return true;
  }
  if (kind === "opt" || kind === "list") {
    return canCompile(schema[1] as Schema, depth + 1);
  }
  if (kind === "struct") {
    for (const [, field] of schema[1] as readonly Field[]) {
      if (!canCompile(field, depth + 1)) {
        return false;
      }
    }
    return true;
  }
  return false;
}

function emitStoreScalar(kind: string, at: string, expr: string): string {
  switch (kind) {
    case "bool":
      return `b[${at}] = ${expr} ? 1 : 0;`;
    case "i8":
    case "u8":
      return `b[${at}] = ${expr} & 255;`;
    case "i16":
    case "u16":
      return `{ const _v = ${expr}; b[${at}] = _v; b[${at}+1] = _v >>> 8; }`;
    case "i32":
    case "u32":
      return `{ const _v = ${expr}; b[${at}] = _v; b[${at}+1] = _v >>> 8; b[${at}+2] = _v >>> 16; b[${at}+3] = _v >>> 24; }`;
    case "i64":
    case "int":
      return `writeI64Fast(b, ${at}, ${expr});`;
    case "u64":
    case "uint":
      return `writeU64Fast(b, ${at}, ${expr});`;
    case "f32":
      return `{ const _v = ${expr}; if (typeof _v === "number") dv.setFloat32(${at}, _v, true); else writeF32(b, ${at}, _v); }`;
    case "f64":
      return `{ const _v = ${expr}; if (typeof _v === "number") dv.setFloat64(${at}, _v, true); else writeF64(b, ${at}, _v); }`;
    default:
      return "";
  }
}

function emitLoadScalar(kind: string, at: string, dst: string): string {
  switch (kind) {
    case "bool":
      return `{ const _t = b[${at}]; if (_t > 1) throw typeError(); ${dst} = _t === 1; }`;
    case "i8":
      return `${dst} = (b[${at}] << 24) >> 24;`;
    case "u8":
      return `${dst} = b[${at}];`;
    case "i16":
      return `${dst} = ((b[${at}] | (b[${at}+1] << 8)) << 16) >> 16;`;
    case "u16":
      return `${dst} = b[${at}] | (b[${at}+1] << 8);`;
    case "i32":
      return `${dst} = b[${at}] | (b[${at}+1] << 8) | (b[${at}+2] << 16) | (b[${at}+3] << 24);`;
    case "u32":
      return `${dst} = (b[${at}] | (b[${at}+1] << 8) | (b[${at}+2] << 16) | (b[${at}+3] << 24)) >>> 0;`;
    case "i64":
    case "int":
      return `${dst} = readI64Fit(b, ${at});`;
    case "u64":
    case "uint":
      return `${dst} = readU64Fit(b, ${at});`;
    case "f32":
      return `{ const _f = dv.getFloat32(${at}, true); ${dst} = _f === _f ? _f : readF32(b, ${at}); }`;
    case "f64":
      return `{ const _f = dv.getFloat64(${at}, true); ${dst} = _f === _f ? _f : readF64(b, ${at}); }`;
    default:
      return `${dst} = 0;`;
  }
}

function emitEnsure(extraExpr: string): string {
  return `if (e + (${extraExpr}) > b.length) { w.end = e; ensure(w, ${extraExpr}); b = w.buf; dv = w.dv; }`;
}

export type CompiledEncoder = (w: Sink, val: unknown, cap: number) => void;
export type CompiledDecoder = (
  buf: Uint8Array,
  dv: DataView,
  cap: number,
  trusted: boolean,
  standalone: boolean,
) => unknown;

export function compileEncode(schema: Schema): CompiledEncoder | null {
  if (!canCompile(schema, 0)) {
    return null;
  }
  const parts: string[] = ["let e = w.end;", "let b = w.buf;", "let dv = w.dv;"];
  let id = 0;
  const fresh = (p: string) => `${p}${id++}`;

  function emit(node: Schema, src: string): void {
    const kind = node[0];
    const width = FIXED[kind];
    if (width !== undefined) {
      parts.push(emitEnsure(String(width)));
      parts.push(emitStoreScalar(kind, "e", src));
      parts.push(`e += ${width};`);
      return;
    }
    if (kind === "str") {
      parts.push(`w.end = e; writeStr(w, ${src}, cap); e = w.end; b = w.buf; dv = w.dv;`);
      return;
    }
    if (kind === "bytes") {
      const r = fresh("raw");
      parts.push(`{ const ${r} = ${src}; const _n = ${r}.length; if (_n > cap) throw limit();`);
      parts.push(emitEnsure("4 + _n"));
      parts.push(`b[e] = _n; b[e+1] = _n >>> 8; b[e+2] = _n >>> 16; b[e+3] = _n >>> 24; e += 4;`);
      parts.push(`b.set(${r}, e); e += _n; }`);
      return;
    }
    if (kind === "opt") {
      const ov = fresh("ov");
      parts.push(`{ const ${ov} = ${src};`);
      parts.push(emitEnsure("1"));
      parts.push(`if (${ov} == null) { b[e++] = 0; } else { b[e++] = 1;`);
      emit(node[1] as Schema, ov);
      parts.push(`} }`);
      return;
    }
    if (kind === "struct") {
      const obj = fresh("s");
      const fields = node[1] as readonly Field[];
      parts.push(`{ const ${obj} = ${src};`);
      let chunk: string[] = [];
      let chunkBytes = 0;
      const flush = () => {
        if (chunkBytes === 0) {
          return;
        }
        parts.push(emitEnsure(String(chunkBytes)));
        parts.push(...chunk);
        chunk = [];
        chunkBytes = 0;
      };
      for (const [name, field] of fields) {
        const fk = field[0];
        const key = JSON.stringify(name);
        const fw = FIXED[fk];
        if (fw !== undefined) {
          chunk.push(emitStoreScalar(fk, "e", `${obj}[${key}]`));
          chunk.push(`e += ${fw};`);
          chunkBytes += fw;
        } else {
          flush();
          emit(field, `${obj}[${key}]`);
        }
      }
      flush();
      parts.push(`}`);
      return;
    }
    if (kind === "list") {
      const elem = node[1] as Schema;
      const ek = elem[0];
      const arr = fresh("a");
      const len = fresh("n");
      const idx = fresh("i");
      parts.push(`{ const ${arr} = ${src}; const ${len} = ${arr}.length; if (${len} > cap) throw limit();`);
      const ew = FIXED[ek];
      if (ew !== undefined) {
        parts.push(emitEnsure(`4 + ${len} * ${ew}`));
        parts.push(`b[e] = ${len}; b[e+1] = ${len} >>> 8; b[e+2] = ${len} >>> 16; b[e+3] = ${len} >>> 24; e += 4;`);
        if (ek === "u8" || ek === "i8") {
          parts.push(`if (${arr} instanceof Uint8Array) { b.set(${arr}, e); e += ${len}; }`);
          parts.push(`else { for (let ${idx} = 0; ${idx} < ${len}; ${idx}++) b[e++] = ${arr}[${idx}] & 255; }`);
        } else if (ek === "f64") {
          if (IS_LE) {
            parts.push(
              `if (${arr} instanceof Float64Array) { b.set(new Uint8Array(${arr}.buffer, ${arr}.byteOffset, ${len} * 8), e); e += ${len} * 8; } else {`,
            );
          }
          parts.push(`for (let ${idx} = 0; ${idx} < ${len}; ${idx}++) {`);
          parts.push(`  const _x = ${arr}[${idx}];`);
          parts.push(`  if (typeof _x === "number") dv.setFloat64(e, _x, true); else writeF64(b, e, _x);`);
          parts.push(`  e += 8;`);
          parts.push(`}`);
          if (IS_LE) {
            parts.push(`}`);
          }
        } else if (ek === "f32") {
          if (IS_LE) {
            parts.push(
              `if (${arr} instanceof Float32Array) { b.set(new Uint8Array(${arr}.buffer, ${arr}.byteOffset, ${len} * 4), e); e += ${len} * 4; } else {`,
            );
          }
          parts.push(`for (let ${idx} = 0; ${idx} < ${len}; ${idx}++) {`);
          parts.push(`  const _x = ${arr}[${idx}];`);
          parts.push(`  if (typeof _x === "number") dv.setFloat32(e, _x, true); else writeF32(b, e, _x);`);
          parts.push(`  e += 4;`);
          parts.push(`}`);
          if (IS_LE) {
            parts.push(`}`);
          }
        } else if (ek === "i32" || ek === "u32") {
          parts.push(`for (let ${idx} = 0; ${idx} < ${len}; ${idx}++) {`);
          parts.push(`  const _x = ${arr}[${idx}];`);
          parts.push(`  b[e] = _x; b[e+1] = _x >>> 8; b[e+2] = _x >>> 16; b[e+3] = _x >>> 24; e += 4;`);
          parts.push(`}`);
        } else {
          parts.push(`for (let ${idx} = 0; ${idx} < ${len}; ${idx}++) {`);
          parts.push(`  ${emitStoreScalar(ek, "e", `${arr}[${idx}]`)}`);
          parts.push(`  e += ${ew};`);
          parts.push(`}`);
        }
        parts.push(`}`);
        return;
      }
      parts.push(emitEnsure("4"));
      parts.push(`b[e] = ${len}; b[e+1] = ${len} >>> 8; b[e+2] = ${len} >>> 16; b[e+3] = ${len} >>> 24; e += 4;`);
      parts.push(`for (let ${idx} = 0; ${idx} < ${len}; ${idx}++) {`);
      emit(elem, `${arr}[${idx}]`);
      parts.push(`}`);
      parts.push(`}`);
      return;
    }
  }

  emit(schema, "val");
  parts.push("w.end = e;");

  const limit = () => new KilnError("LIMIT");
  const factory = new Function(
    "ensure",
    "writeStr",
    "writeI64Fast",
    "writeU64Fast",
    "writeF32",
    "writeF64",
    "limit",
    `"use strict";\nreturn function kilnEncode(w, val, cap) {\n${parts.join("\n")}\n};`,
  );
  return factory(ensure, writeStr, writeI64Fast, writeU64Fast, writeF32, writeF64, limit) as CompiledEncoder;
}

export function compileDecode(schema: Schema): CompiledDecoder | null {
  if (!canCompile(schema, 0)) {
    return null;
  }
  const parts: string[] = ["const b = buf;", "const len = b.length;", "let o = 0;", "let root;"];
  let id = 0;
  const fresh = (p: string) => `${p}${id++}`;

  function emit(node: Schema, dst: string): void {
    const kind = node[0];
    const width = FIXED[kind];
    if (width !== undefined) {
      parts.push(`if (o + ${width} > len) throw eof();`);
      parts.push(emitLoadScalar(kind, "o", dst));
      parts.push(`o += ${width};`);
      return;
    }
    if (kind === "str") {
      parts.push(`{ if (o + 4 > len) throw eof();`);
      parts.push(`const _sl = (b[o] | (b[o+1] << 8) | (b[o+2] << 16) | (b[o+3] << 24)) >>> 0;`);
      parts.push(`if (_sl > cap) throw limit(); o += 4; const _se = o + _sl; if (_se > len) throw eof();`);
      parts.push(`${dst} = _sl === 0 ? "" : decodeStrSlice(b, o, _se, trusted); o = _se; }`);
      return;
    }
    if (kind === "bytes") {
      parts.push(`{ if (o + 4 > len) throw eof();`);
      parts.push(`const _bl = (b[o] | (b[o+1] << 8) | (b[o+2] << 16) | (b[o+3] << 24)) >>> 0;`);
      parts.push(`if (_bl > cap) throw limit(); o += 4; const _be = o + _bl; if (_be > len) throw eof();`);
      parts.push(`${dst} = Uint8Array.from(b.subarray(o, _be)); o = _be; }`);
      return;
    }
    if (kind === "opt") {
      parts.push(`{ if (o >= len) throw eof(); const _tag = b[o++];`);
      parts.push(`if (_tag === 0) { ${dst} = null; } else if (_tag === 1) {`);
      emit(node[1] as Schema, dst);
      parts.push(`} else { throw typeError(); } }`);
      return;
    }
    if (kind === "struct") {
      const fields = node[1] as readonly Field[];
      const vars: string[] = [];
      for (let i = 0; i < fields.length; i++) {
        vars.push(fresh("f"));
      }
      if (vars.length > 0) {
        parts.push(`let ${vars.join(", ")};`);
      }
      let chunk: string[] = [];
      let chunkBytes = 0;
      const flush = () => {
        if (chunkBytes === 0) {
          return;
        }
        parts.push(`if (o + ${chunkBytes} > len) throw eof();`);
        parts.push(...chunk);
        chunk = [];
        chunkBytes = 0;
      };
      for (let i = 0; i < fields.length; i++) {
        const [, field] = fields[i];
        const fk = field[0];
        const fw = FIXED[fk];
        if (fw !== undefined) {
          chunk.push(emitLoadScalar(fk, "o", vars[i]));
          chunk.push(`o += ${fw};`);
          chunkBytes += fw;
        } else {
          flush();
          emit(field, vars[i]);
        }
      }
      flush();
      const props = fields.map(([name], i) => `${JSON.stringify(name)}: ${vars[i]}`).join(", ");
      parts.push(`${dst} = { ${props} };`);
      return;
    }
    if (kind === "list") {
      const elem = node[1] as Schema;
      const ek = elem[0];
      const cnt = fresh("c");
      const arr = fresh("a");
      const idx = fresh("i");
      const emin = schemaMinSize(elem);
      parts.push(`{ if (o + 4 > len) throw eof();`);
      parts.push(`const ${cnt} = (b[o] | (b[o+1] << 8) | (b[o+2] << 16) | (b[o+3] << 24)) >>> 0;`);
      parts.push(`if (${cnt} > cap) throw limit(); o += 4;`);
      if (emin > 0) {
        parts.push(`if (${cnt} * ${emin} > len - o) throw eof();`);
      }
      const ew = FIXED[ek];
      if (ew !== undefined) {
        if (ek === "u8") {
          parts.push(`${dst} = Uint8Array.from(b.subarray(o, o + ${cnt})); o += ${cnt}; }`);
          return;
        }
        parts.push(`const ${arr} = new Array(${cnt});`);
        if (ek === "f64") {
          parts.push(`for (let ${idx} = 0; ${idx} < ${cnt}; ${idx}++) {`);
          parts.push(`  const _f = dv.getFloat64(o, true); ${arr}[${idx}] = _f === _f ? _f : readF64(b, o); o += 8;`);
          parts.push(`}`);
        } else if (ek === "f32") {
          parts.push(`for (let ${idx} = 0; ${idx} < ${cnt}; ${idx}++) {`);
          parts.push(`  const _f = dv.getFloat32(o, true); ${arr}[${idx}] = _f === _f ? _f : readF32(b, o); o += 4;`);
          parts.push(`}`);
        } else if (ek === "i32") {
          parts.push(`for (let ${idx} = 0; ${idx} < ${cnt}; ${idx}++) {`);
          parts.push(`  ${arr}[${idx}] = b[o] | (b[o+1] << 8) | (b[o+2] << 16) | (b[o+3] << 24); o += 4;`);
          parts.push(`}`);
        } else if (ek === "i64" || ek === "int") {
          parts.push(`for (let ${idx} = 0; ${idx} < ${cnt}; ${idx}++) {`);
          parts.push(`  ${arr}[${idx}] = readI64Fit(b, o); o += 8;`);
          parts.push(`}`);
        } else {
          parts.push(`for (let ${idx} = 0; ${idx} < ${cnt}; ${idx}++) {`);
          parts.push(`  ${emitLoadScalar(ek, "o", `${arr}[${idx}]`)}`);
          parts.push(`  o += ${ew};`);
          parts.push(`}`);
        }
        parts.push(`${dst} = ${arr}; }`);
        return;
      }
      parts.push(`const ${arr} = new Array(${cnt});`);
      parts.push(`for (let ${idx} = 0; ${idx} < ${cnt}; ${idx}++) {`);
      emit(elem, `${arr}[${idx}]`);
      parts.push(`}`);
      parts.push(`${dst} = ${arr}; }`);
      return;
    }
  }

  emit(schema, "root");
  parts.push("if (standalone) { if (o !== len) throw trailing(); return root; }");
  parts.push("return [root, o];");

  const eof = () => new KilnError("EOF");
  const limit = () => new KilnError("LIMIT");
  const typeError = () => new KilnError("TYPE");
  const trailing = () => new KilnError("TRAILING");

  const factory = new Function(
    "decodeStrSlice",
    "eof",
    "limit",
    "typeError",
    "trailing",
    "readI64Fit",
    "readU64Fit",
    "readF32",
    "readF64",
    `"use strict";\nreturn function kilnDecode(buf, dv, cap, trusted, standalone) {\n${parts.join("\n")}\n};`,
  );
  return factory(
    decodeStrSlice,
    eof,
    limit,
    typeError,
    trailing,
    readI64Fit,
    readU64Fit,
    readF32,
    readF64,
  ) as CompiledDecoder;
}
