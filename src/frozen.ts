/** Frozen positional values. The caller passes the schema. */

import {
  FloatBits,
  MASK64,
  asInt,
  fitInt,
  readF32,
  readF64,
  readI16,
  readI32,
  readI64,
  readU16,
  readU32,
  readU64,
  writeF32,
  writeF64,
  writeI16,
  writeI32,
  writeI64,
  writeU16,
  writeU32,
  writeU64,
} from "./binary.ts";
import { KilnError } from "./error.ts";
import { typeHash } from "./hashing.ts";
import type { Field, Schema } from "./schema.ts";
import { compileDecode, compileEncode, readStr, type Sink } from "./structplan.ts";
import { CAP, HEADER, decodeTensors, encodeTensors, type TensorIn } from "./tensor.ts";

const WIDTH: Record<string, number> = {
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

const PACK = new Set([
  "i8",
  "i16",
  "i32",
  "i64",
  "int",
  "u8",
  "u16",
  "u32",
  "u64",
  "uint",
  "f32",
  "f64",
]);

const utf8 = new TextEncoder();

export function minSize(schema: Schema): number {
  const kind = schema[0];
  const width = WIDTH[kind];
  if (width !== undefined) {
    return width;
  }
  if (kind === "str" || kind === "bytes") {
    return 4;
  }
  if (kind === "tensors") {
    return HEADER;
  }
  if (kind === "opt") {
    return 1;
  }
  if (kind === "list" || kind === "dict") {
    return 4;
  }
  if (kind === "struct") {
    let total = 0;
    for (const [, field] of schema[1] as readonly Field[]) {
      total += minSize(field);
    }
    return total;
  }
  throw new KilnError("TYPE");
}

function elemWidth(schema: Schema): number {
  if (schema[0] === "u8" || schema[0] === "i8") {
    return 1;
  }
  return minSize(schema);
}

function assertFit(count: number, each: number, unread: number, cap: number): void {
  if (count > cap) {
    throw new KilnError("LIMIT");
  }
  if (each > 0 && BigInt(count) > MASK64 / BigInt(each)) {
    throw new KilnError("LIMIT");
  }
  // Reject a hostile count before any element storage is allocated.
  if (BigInt(count) * BigInt(each) > BigInt(unread)) {
    throw new KilnError("EOF");
  }
}

function readScalar(kind: string, buf: Uint8Array, i: number): number | bigint | FloatBits {
  switch (kind) {
    case "i8": {
      const v = buf[i];
      return v & 0x80 ? v - 256 : v;
    }
    case "u8":
      return buf[i];
    case "i16":
      return readI16(buf, i);
    case "u16":
      return readU16(buf, i);
    case "i32":
      return readI32(buf, i);
    case "u32":
      return readU32(buf, i);
    case "i64":
    case "int":
      return fitInt(readI64(buf, i));
    case "u64":
    case "uint":
      return fitInt(readU64(buf, i));
    case "f32":
      return readF32(buf, i);
    case "f64":
      return readF64(buf, i);
    default:
      throw new KilnError("TYPE");
  }
}

function writeScalar(kind: string, buf: Uint8Array, i: number, value: number | bigint | FloatBits): void {
  if (kind === "f32") {
    writeF32(buf, i, value as number | FloatBits);
    return;
  }
  if (kind === "f64") {
    writeF64(buf, i, value as number | FloatBits);
    return;
  }
  const n = typeof value === "bigint" ? Number(value) : (value as number);
  switch (kind) {
    case "i8":
    case "u8":
      buf[i] = n & 0xff;
      return;
    case "i16":
      writeI16(buf, i, n);
      return;
    case "u16":
      writeU16(buf, i, n);
      return;
    case "i32":
      writeI32(buf, i, n);
      return;
    case "u32":
      writeU32(buf, i, n >>> 0);
      return;
    case "i64":
    case "int":
      writeI64(buf, i, asInt(value as number | bigint));
      return;
    case "u64":
    case "uint":
      writeU64(buf, i, asInt(value as number | bigint));
      return;
    default:
      throw new KilnError("TYPE");
  }
}

function compareUtf8(a: string, b: string): number {
  const ab = utf8.encode(a);
  const bb = utf8.encode(b);
  const n = Math.min(ab.length, bb.length);
  for (let i = 0; i < n; i++) {
    if (ab[i] !== bb[i]) {
      return ab[i] - bb[i];
    }
  }
  return ab.length - bb.length;
}

function bytesLess(a: Uint8Array, b: Uint8Array): boolean {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) {
      return a[i] < b[i];
    }
  }
  return a.length < b.length;
}

const encodePlans = new WeakMap<object, ((w: Sink, value: Record<string, unknown>, cap: number) => void) | null>();
const decodePlans = new WeakMap<
  object,
  ((buf: Uint8Array, cap: number, trusted: boolean) => [Record<string, unknown>, number]) | null
>();

function encoderFor(schema: Schema) {
  const key = schema as object;
  if (encodePlans.has(key)) {
    return encodePlans.get(key) ?? null;
  }
  const plan = compileEncode(schema);
  encodePlans.set(key, plan);
  return plan;
}

function decoderFor(schema: Schema) {
  const key = schema as object;
  if (decodePlans.has(key)) {
    return decodePlans.get(key) ?? null;
  }
  const plan = compileDecode(schema);
  decodePlans.set(key, plan);
  return plan;
}

export class Writer {
  buf: Uint8Array;
  end = 0;

  constructor(capacity = 64) {
    this.buf = new Uint8Array(capacity);
  }

  encode(schema: Schema, value: unknown, cap = CAP): Uint8Array {
    this.end = 0;
    const plan = encoderFor(schema);
    if (plan) {
      plan(this, value as Record<string, unknown>, cap);
      return this.buf.subarray(0, this.end);
    }
    this.write(schema, value, cap, 0);
    return this.buf.subarray(0, this.end);
  }

  encodeFramed(schema: Schema, value: unknown, cap = CAP): Uint8Array {
    const body = encode(schema, value, cap);
    this.end = 0;
    this.reserve(16 + body.length);
    this.buf[0] = 0x4b;
    this.buf[1] = 0x4c;
    this.buf[2] = 0x4e;
    this.buf[3] = 0x30;
    this.buf[4] = 0;
    this.buf[5] = 0;
    this.buf[6] = 0;
    this.buf[7] = 0;
    writeU64(this.buf, 8, typeHash(schema));
    this.buf.set(body, 16);
    this.end = 16 + body.length;
    return this.buf.subarray(0, this.end);
  }

  private reserve(extra: number): void {
    const need = this.end + extra;
    if (need <= this.buf.length) {
      return;
    }
    let cap = this.buf.length * 2;
    if (cap < need) {
      cap = need;
    }
    const grown = new Uint8Array(cap);
    grown.set(this.buf.subarray(0, this.end), 0);
    this.buf = grown;
  }

  private u32(value: number): void {
    this.reserve(4);
    writeU32(this.buf, this.end, value);
    this.end += 4;
  }

  private bytes(raw: Uint8Array, cap: number): void {
    if (raw.length > cap) {
      throw new KilnError("LIMIT");
    }
    this.u32(raw.length);
    this.reserve(raw.length);
    this.buf.set(raw, this.end);
    this.end += raw.length;
  }

  private writeString(value: string, cap: number): void {
    const max = value.length * 3;
    this.reserve(4 + max);
    const encoded = utf8.encodeInto(value, this.buf.subarray(this.end + 4));
    if (encoded.read !== value.length) {
      throw new KilnError("LIMIT");
    }
    const written = encoded.written;
    if (written > cap) {
      throw new KilnError("LIMIT");
    }
    writeU32(this.buf, this.end, written);
    this.end += 4 + written;
  }

  private write(schema: Schema, value: unknown, cap: number, depth: number): void {
    if (depth > 64) {
      throw new KilnError("LIMIT");
    }
    const kind = schema[0];
    if (kind === "bool") {
      this.reserve(1);
      this.buf[this.end++] = value ? 1 : 0;
      return;
    }
    if (PACK.has(kind)) {
      const width = WIDTH[kind];
      this.reserve(width);
      writeScalar(kind, this.buf, this.end, value as number | bigint);
      this.end += width;
      return;
    }
    if (kind === "str") {
      this.writeString(value as string, cap);
      return;
    }
    if (kind === "bytes") {
      this.bytes(value as Uint8Array, cap);
      return;
    }
    if (kind === "tensors") {
      const list = Array.isArray(value) ? value : (value as { tensors: TensorIn[] }).tensors;
      const raw = encodeTensors(list);
      this.reserve(raw.length);
      this.buf.set(raw, this.end);
      this.end += raw.length;
      return;
    }
    if (kind === "opt") {
      this.reserve(1);
      if (value == null) {
        this.buf[this.end++] = 0;
        return;
      }
      this.buf[this.end++] = 1;
      this.write(schema[1] as Schema, value, cap, depth + 1);
      return;
    }
    if (kind === "list") {
      this.writeList(schema[1] as Schema, value as ArrayLike<unknown>, cap, depth);
      return;
    }
    if (kind === "dict") {
      const obj = value as Record<string, unknown>;
      const keys = Object.keys(obj).sort(compareUtf8);
      assertFit(keys.length, 4, Number.MAX_SAFE_INTEGER, cap);
      this.u32(keys.length);
      for (const key of keys) {
        this.writeString(key, cap);
        this.write(schema[1] as Schema, obj[key], cap, depth + 1);
      }
      return;
    }
    if (kind === "struct") {
      const obj = value as Record<string, unknown>;
      for (const [name, field] of schema[1] as readonly Field[]) {
        const fk = field[0];
        const item = obj[name];
        if (PACK.has(fk)) {
          const width = WIDTH[fk];
          this.reserve(width);
          writeScalar(fk, this.buf, this.end, item as number | bigint);
          this.end += width;
        } else if (fk === "bool") {
          this.reserve(1);
          this.buf[this.end++] = item ? 1 : 0;
        } else if (fk === "str") {
          this.writeString(item as string, cap);
        } else if (fk === "bytes") {
          this.bytes(item as Uint8Array, cap);
        } else {
          this.write(field, item, cap, depth + 1);
        }
      }
      return;
    }
    throw new KilnError("TYPE");
  }

  private writeList(elem: Schema, value: ArrayLike<unknown>, cap: number, depth: number): void {
    const count = value.length;
    assertFit(count, elemWidth(elem), Number.MAX_SAFE_INTEGER, cap);
    this.u32(count);
    const ek = elem[0];
    if (ek === "u8" || ek === "i8") {
      let raw: Uint8Array;
      if (value instanceof Uint8Array) {
        raw = value;
      } else {
        raw = new Uint8Array(count);
        for (let i = 0; i < count; i++) {
          raw[i] = (value[i] as number) & 0xff;
        }
      }
      if (raw.length > cap) {
        throw new KilnError("LIMIT");
      }
      this.reserve(raw.length);
      this.buf.set(raw, this.end);
      this.end += raw.length;
      return;
    }
    if (PACK.has(ek)) {
      const width = WIDTH[ek];
      this.reserve(count * width);
      for (let i = 0; i < count; i++) {
        writeScalar(ek, this.buf, this.end, value[i] as number | bigint);
        this.end += width;
      }
      return;
    }
    for (let i = 0; i < count; i++) {
      this.write(elem, value[i], cap, depth + 1);
    }
  }
}

export interface CodecOptions {
  cap?: number;
  standalone?: boolean;
  trusted?: boolean;
}

export function encode(schema: Schema, value: unknown, cap = CAP): Uint8Array {
  const writer = new Writer();
  return Uint8Array.from(writer.encode(schema, value, cap));
}

export function encodeFramed(schema: Schema, value: unknown, cap = CAP): Uint8Array {
  const writer = new Writer();
  return Uint8Array.from(writer.encodeFramed(schema, value, cap));
}

export function decode(schema: Schema, buf: Uint8Array, opts: CodecOptions = {}): unknown {
  const cap = opts.cap ?? CAP;
  const standalone = opts.standalone !== false;
  const trusted = opts.trusted === true;
  const plan = decoderFor(schema);
  if (plan) {
    const [value, end] = plan(buf, cap, trusted);
    if (standalone && end !== buf.length) {
      throw new KilnError("TRAILING");
    }
    return value;
  }
  const [value, end] = readValue(schema, buf, 0, cap, 0, trusted);
  if (standalone && end !== buf.length) {
    throw new KilnError("TRAILING");
  }
  return value;
}

export function decodeFramed(schema: Schema, buf: Uint8Array, opts: CodecOptions = {}): unknown {
  const cap = opts.cap ?? CAP;
  const trusted = opts.trusted === true;
  if (buf.length < 16) {
    throw new KilnError("EOF");
  }
  if (
    buf[0] !== 0x4b ||
    buf[1] !== 0x4c ||
    buf[2] !== 0x4e ||
    buf[3] !== 0x30 ||
    buf[4] !== 0 ||
    buf[5] !== 0 ||
    buf[6] !== 0 ||
    buf[7] !== 0
  ) {
    throw new KilnError("FRAME");
  }
  if (readU64(buf, 8) !== typeHash(schema)) {
    throw new KilnError("SCHEMA");
  }
  const [value, end] = readValue(schema, buf, 16, cap, 0, trusted);
  if (end !== buf.length) {
    throw new KilnError("TRAILING");
  }
  return value;
}

function readValue(
  schema: Schema,
  buf: Uint8Array,
  i: number,
  cap: number,
  depth: number,
  trusted: boolean,
): [unknown, number] {
  if (depth > 64) {
    throw new KilnError("LIMIT");
  }
  const kind = schema[0];
  if (kind === "bool") {
    if (i >= buf.length) {
      throw new KilnError("EOF");
    }
    const byte = buf[i];
    if (byte > 1) {
      throw new KilnError("TYPE");
    }
    return [byte === 1, i + 1];
  }
  if (PACK.has(kind)) {
    const width = WIDTH[kind];
    if (i + width > buf.length) {
      throw new KilnError("EOF");
    }
    return [readScalar(kind, buf, i), i + width];
  }
  if (kind === "str") {
    return readStr(buf, i, cap, trusted);
  }
  if (kind === "bytes") {
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
    return [Uint8Array.from(buf.subarray(start, end)), end];
  }
  if (kind === "tensors") {
    const [directory, block] = decodeTensors(buf.subarray(i), {
      standalone: false,
      cap,
      trusted,
    });
    return [directory, i + block];
  }
  if (kind === "opt") {
    if (i >= buf.length) {
      throw new KilnError("EOF");
    }
    const tag = buf[i];
    if (tag === 0) {
      return [null, i + 1];
    }
    if (tag !== 1) {
      throw new KilnError("TYPE");
    }
    return readValue(schema[1] as Schema, buf, i + 1, cap, depth + 1, trusted);
  }
  if (kind === "list") {
    return readList(schema[1] as Schema, buf, i, cap, depth, trusted);
  }
  if (kind === "dict") {
    if (i + 4 > buf.length) {
      throw new KilnError("EOF");
    }
    const count = readU32(buf, i);
    assertFit(count, 4, buf.length - (i + 4), cap);
    let cursor = i + 4;
    const out: Record<string, unknown> = {};
    let prev = new Uint8Array(0);
    for (let n = 0; n < count; n++) {
      const [key, next] = readValue(["str"], buf, cursor, cap, depth + 1, trusted);
      const rawKey = utf8.encode(key as string);
      if (bytesLess(rawKey, prev)) {
        throw new KilnError("TYPE");
      }
      prev = rawKey;
      const [item, after] = readValue(schema[1] as Schema, buf, next, cap, depth + 1, trusted);
      out[key as string] = item;
      cursor = after;
    }
    return [out, cursor];
  }
  if (kind === "struct") {
    const out: Record<string, unknown> = {};
    let cursor = i;
    for (const [name, field] of schema[1] as readonly Field[]) {
      const fk = field[0];
      if (PACK.has(fk)) {
        const width = WIDTH[fk];
        if (cursor + width > buf.length) {
          throw new KilnError("EOF");
        }
        out[name] = readScalar(fk, buf, cursor);
        cursor += width;
      } else if (fk === "bool") {
        if (cursor >= buf.length) {
          throw new KilnError("EOF");
        }
        const byte = buf[cursor];
        if (byte > 1) {
          throw new KilnError("TYPE");
        }
        out[name] = byte === 1;
        cursor += 1;
      } else {
        const [item, next] = readValue(field, buf, cursor, cap, depth + 1, trusted);
        out[name] = item;
        cursor = next;
      }
    }
    return [out, cursor];
  }
  throw new KilnError("TYPE");
}

function readList(
  elem: Schema,
  buf: Uint8Array,
  i: number,
  cap: number,
  depth: number,
  trusted: boolean,
): [unknown, number] {
  if (i + 4 > buf.length) {
    throw new KilnError("EOF");
  }
  const count = readU32(buf, i);
  assertFit(count, elemWidth(elem), buf.length - (i + 4), cap);
  const start = i + 4;
  const ek = elem[0];
  if (ek === "u8" || ek === "i8" || PACK.has(ek)) {
    const width = WIDTH[ek];
    const end = start + count * width;
    if (ek === "u8") {
      return [Uint8Array.from(buf.subarray(start, end)), end];
    }
    const out = new Array<number | bigint>(count);
    for (let n = 0; n < count; n++) {
      out[n] = readScalar(ek, buf, start + n * width);
    }
    return [out, end];
  }
  const out: unknown[] = [];
  let cursor = start;
  for (let n = 0; n < count; n++) {
    const [item, next] = readValue(elem, buf, cursor, cap, depth + 1, trusted);
    out.push(item);
    cursor = next;
  }
  return [out, cursor];
}
