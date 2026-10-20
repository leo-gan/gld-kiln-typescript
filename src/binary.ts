import { KilnError } from "./error.ts";

export const MASK64 = (1n << 64n) - 1n;

export function align64(n: number): number {
  const rem = n % 64;
  return rem === 0 ? n : n + 64 - rem;
}

export function align64b(n: bigint): bigint {
  const rem = n & 63n;
  return rem === 0n ? n : n + 64n - rem;
}

export function add64(a: bigint, b: bigint): bigint {
  const total = a + b;
  if (total > MASK64) {
    throw new KilnError("LIMIT");
  }
  return total;
}

export function mul64(a: bigint, b: bigint): bigint {
  if (a !== 0n && b > MASK64 / a) {
    throw new KilnError("LIMIT");
  }
  return a * b;
}

export function readU16(buf: Uint8Array, o: number): number {
  return buf[o] | (buf[o + 1] << 8);
}

export function readU32(buf: Uint8Array, o: number): number {
  return (
    (buf[o] | (buf[o + 1] << 8) | (buf[o + 2] << 16) | (buf[o + 3] << 24)) >>> 0
  );
}

export function readU64(buf: Uint8Array, o: number): bigint {
  return BigInt(readU32(buf, o)) | (BigInt(readU32(buf, o + 4)) << 32n);
}

export function readI16(buf: Uint8Array, o: number): number {
  const v = readU16(buf, o);
  return v & 0x8000 ? v - 0x10000 : v;
}

export function readI32(buf: Uint8Array, o: number): number {
  return buf[o] | (buf[o + 1] << 8) | (buf[o + 2] << 16) | (buf[o + 3] << 24);
}

export function readI64(buf: Uint8Array, o: number): bigint {
  const u = readU64(buf, o);
  return u >= 0x8000000000000000n ? u - 0x10000000000000000n : u;
}

export function writeU16(buf: Uint8Array, o: number, v: number): void {
  buf[o] = v;
  buf[o + 1] = v >>> 8;
}

export function writeU32(buf: Uint8Array, o: number, v: number): void {
  buf[o] = v;
  buf[o + 1] = v >>> 8;
  buf[o + 2] = v >>> 16;
  buf[o + 3] = v >>> 24;
}

export function writeU64(buf: Uint8Array, o: number, v: bigint): void {
  const x = v & MASK64;
  writeU32(buf, o, Number(x & 0xffffffffn));
  writeU32(buf, o + 4, Number((x >> 32n) & 0xffffffffn));
}

const TWO32 = 4294967296;
const TWO64 = 18446744073709551616;

export function readU64n(buf: Uint8Array, o: number): number {
  return readU32(buf, o) + readU32(buf, o + 4) * TWO32;
}

export function writeU64n(buf: Uint8Array, o: number, v: number): void {
  writeU32(buf, o, v >>> 0);
  writeU32(buf, o + 4, Math.floor(v / TWO32));
}

export function add64n(a: number, b: number): number {
  const total = a + b;
  if (total >= TWO64) {
    throw new KilnError("LIMIT");
  }
  return total;
}

export function mul64n(a: number, b: number): number {
  const total = a * b;
  if (total >= TWO64) {
    throw new KilnError("LIMIT");
  }
  return total;
}

export function writeI16(buf: Uint8Array, o: number, v: number): void {
  writeU16(buf, o, v < 0 ? v + 0x10000 : v);
}

export function writeI32(buf: Uint8Array, o: number, v: number): void {
  writeU32(buf, o, v >>> 0);
}

export function writeI64(buf: Uint8Array, o: number, v: bigint): void {
  writeU64(buf, o, v);
}

const tmp = new ArrayBuffer(8);
const tmpBytes = new Uint8Array(tmp);
const tmpView = new DataView(tmp);

/** A float whose IEEE payload does not survive a bare JS number return. */
export class FloatBits {
  readonly kind: "f32" | "f64";
  readonly bits: bigint;

  constructor(kind: "f32" | "f64", bits: bigint) {
    this.kind = kind;
    this.bits = bits;
  }

  valueOf(): number {
    if (this.kind === "f64") {
      tmpView.setBigUint64(0, this.bits, true);
      return tmpView.getFloat64(0, true);
    }
    tmpView.setUint32(0, Number(this.bits), true);
    return tmpView.getFloat32(0, true);
  }
}

export function readF32(buf: Uint8Array, o: number): number | FloatBits {
  const bits = readU32(buf, o);
  const frac = bits & 0x7fffff;
  if ((bits >>> 23) === 0xff && frac !== 0) {
    return new FloatBits("f32", BigInt(bits));
  }
  tmpView.setUint32(0, bits, true);
  return tmpView.getFloat32(0, true);
}

export function readF64(buf: Uint8Array, o: number): number | FloatBits {
  const bits = readU64(buf, o);
  const frac = bits & ((1n << 52n) - 1n);
  if (((bits >> 52n) & 0x7ffn) === 0x7ffn && frac !== 0n) {
    return new FloatBits("f64", bits);
  }
  tmpView.setBigUint64(0, bits, true);
  return tmpView.getFloat64(0, true);
}

export function writeF32(buf: Uint8Array, o: number, v: number | FloatBits): void {
  if (v instanceof FloatBits) {
    writeU32(buf, o, Number(v.bits));
    return;
  }
  tmpView.setFloat32(0, v, true);
  buf[o] = tmpBytes[0];
  buf[o + 1] = tmpBytes[1];
  buf[o + 2] = tmpBytes[2];
  buf[o + 3] = tmpBytes[3];
}

export function writeF64(buf: Uint8Array, o: number, v: number | FloatBits): void {
  if (v instanceof FloatBits) {
    writeU64(buf, o, v.bits);
    return;
  }
  tmpView.setFloat64(0, v, true);
  buf.set(tmpBytes, o);
}

export function isZero(buf: Uint8Array, start: number, end: number): boolean {
  for (let i = start; i < end; i++) {
    if (buf[i] !== 0) {
      return false;
    }
  }
  return true;
}

export function fitInt(v: bigint): number | bigint {
  const n = Number(v);
  return BigInt(n) === v ? n : v;
}

export function asInt(v: number | bigint): bigint {
  return typeof v === "bigint" ? v : BigInt(Math.trunc(v));
}
