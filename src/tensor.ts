/** Version-2 tensor directory. Payloads are views of the input buffer. */

import {
  add64n,
  align64,
  isZero,
  mul64n,
  readU16,
  readU32,
  readU64n,
  writeU16,
  writeU32,
  writeU64n,
} from "./binary.ts";
import { KilnError } from "./error.ts";

export const HEADER = 64;
export const DESC = 128;
export const CAP = 16_777_216;
const FLAG_NAME = 0x01;
const FLAG_LE = 0x02;
const OPAQUE_MIN = 4096;
const OPAQUE_MAX = 32767;
const EMPTY = new Uint8Array(0);

export const DTYPE: Record<string, number> = {
  f64: 1,
  f32: 2,
  f16: 3,
  bf16: 4,
  f8e4m3: 5,
  f8e5m2: 6,
  bool: 7,
  i8: 8,
  u8: 9,
  i16: 10,
  u16: 11,
  i32: 12,
  u32: 13,
  i64: 14,
  u64: 15,
  i4: 16,
  u4: 17,
  e2m1: 18,
  e8m0: 19,
};

export const DTYPE_NAME: Record<number, string> = {};
for (const [name, code] of Object.entries(DTYPE)) {
  DTYPE_NAME[code] = name;
}

const WHOLE: Record<number, number> = {
  1: 8,
  2: 4,
  3: 2,
  4: 2,
  5: 1,
  6: 1,
  7: 1,
  8: 1,
  9: 1,
  10: 2,
  11: 2,
  12: 4,
  13: 4,
  14: 8,
  15: 8,
  19: 1,
};
const PACKED = new Set([16, 17, 18]);

const utf8 = new TextEncoder();
const utf8Fatal = new TextDecoder("utf-8", { fatal: true });
const utf8Loose = new TextDecoder("utf-8", { fatal: false });

export interface TensorIn {
  dtype: string | number;
  shape: ReadonlyArray<number | bigint>;
  data: Uint8Array;
  name?: string | Uint8Array | null;
  layout?: string | Uint8Array | null;
  block_size?: number | null;
  quant_scheme?: number | null;
  quant_axis?: number | null;
  group_size?: number | null;
  scale_index?: number | null;
  outer_index?: number | null;
}

export interface TensorOut {
  name: string | null;
  dtype: string | number;
  shape: Array<number | bigint>;
  data: Uint8Array;
  quant_scheme: number;
  quant_axis: number;
  group_size: number;
  scale_index: number;
  outer_index: number;
  layout: string | null;
  block_size: number;
}

export interface TensorDirectory {
  version: number;
  flags: string[];
  tensors: TensorOut[];
  block_length: number;
}

interface Prepared {
  dtype: number;
  rank: number;
  shape: number[];
  data: Uint8Array;
  name: Uint8Array;
  layout: Uint8Array;
  nameOff: number;
  nameLen: number;
  layoutOff: number;
  layoutLen: number;
  blockSize: number;
  quantScheme: number;
  quantAxis: number;
  groupSize: number;
  scaleIndex: number;
  outerIndex: number;
  byteOffset: number;
  byteLength: number;
}

function asBytes(value: string | Uint8Array | null | undefined): Uint8Array {
  if (value == null || value === "") {
    return EMPTY;
  }
  if (typeof value === "string") {
    return utf8.encode(value);
  }
  return value;
}

export function elementCount(rank: number, shape: ReadonlyArray<number>): number {
  if (rank === 0) {
    return 1;
  }
  let count = 1;
  for (let dim = 0; dim < rank; dim++) {
    count = mul64n(count, shape[dim]);
  }
  return count;
}

export function expectedBytes(dtype: number, count: number): number {
  const width = WHOLE[dtype];
  if (width !== undefined) {
    return mul64n(count, width);
  }
  if (PACKED.has(dtype)) {
    return Math.floor((count + 1) / 2);
  }
  throw new KilnError("TYPE");
}

function stamp(tensors: Prepared[]): void {
  let heap = 0;
  for (const tensor of tensors) {
    if (tensor.name.length) {
      tensor.nameOff = heap;
      tensor.nameLen = tensor.name.length;
      heap += tensor.name.length;
    } else {
      tensor.nameOff = 0xffff;
      tensor.nameLen = 0;
    }
  }
  for (const tensor of tensors) {
    if (tensor.layout.length) {
      tensor.layoutOff = heap;
      tensor.layoutLen = tensor.layout.length;
      heap += tensor.layout.length;
    } else {
      tensor.layoutOff = 0xffff;
      tensor.layoutLen = 0;
    }
  }
}

export function encodeTensors(tensors: ReadonlyArray<TensorIn>, out?: Uint8Array): Uint8Array {
  const prepared: Prepared[] = [];
  for (const tensor of tensors) {
    const dtype = tensor.dtype;
    const code = typeof dtype === "number" ? dtype : DTYPE[dtype];
    const shape = tensor.shape;
    const rank = shape.length;
    const data = tensor.data;
    const full = new Array<number>(8).fill(0);
    for (let i = 0; i < rank; i++) {
      full[i] = Number(shape[i]);
    }
    prepared.push({
      dtype: code,
      rank,
      shape: full,
      data,
      name: asBytes(tensor.name),
      layout: asBytes(tensor.layout),
      nameOff: 0,
      nameLen: 0,
      layoutOff: 0,
      layoutLen: 0,
      blockSize: tensor.block_size || 0,
      quantScheme: tensor.quant_scheme || 0,
      quantAxis: tensor.quant_axis == null ? 0xffff : tensor.quant_axis,
      groupSize: tensor.group_size || 0,
      scaleIndex: tensor.scale_index == null ? 0xffffffff : tensor.scale_index,
      outerIndex: tensor.outer_index == null ? 0xffffffff : tensor.outer_index,
      byteOffset: 0,
      byteLength: data.length,
    });
  }
  stamp(prepared);
  let end = 0;
  for (const tensor of prepared) {
    tensor.byteOffset = align64(end);
    end = tensor.byteOffset + tensor.byteLength;
  }
  let heapLen = 0;
  for (const tensor of prepared) {
    heapLen += tensor.name.length + tensor.layout.length;
  }
  const count = prepared.length;
  const directoryBytes = count * DESC + heapLen;
  const payloadBase = align64(HEADER + directoryBytes);
  const size = payloadBase + end;
  const block = out && out.length >= size ? out : new Uint8Array(size);
  if (out && block === out) {
    block.fill(0, 0, size);
  }
  block[0] = 0x4b;
  block[1] = 0x4c;
  block[2] = 0x4e;
  block[3] = 0x54;
  block[4] = 2;
  block[5] = FLAG_LE | (prepared.some((tensor) => tensor.name.length) ? FLAG_NAME : 0);
  writeU32(block, 8, count);
  writeU32(block, 12, heapLen);
  writeU64n(block, 16, end);
  writeU64n(block, 24, directoryBytes);
  for (let index = 0; index < count; index++) {
    const tensor = prepared[index];
    const base = HEADER + index * DESC;
    writeU16(block, base, tensor.dtype);
    block[base + 2] = tensor.rank;
    writeU16(block, base + 4, tensor.nameOff);
    writeU16(block, base + 6, tensor.nameLen);
    writeU16(block, base + 8, tensor.layoutOff);
    writeU16(block, base + 10, tensor.layoutLen);
    writeU32(block, base + 12, tensor.blockSize);
    writeU16(block, base + 16, tensor.quantScheme);
    writeU16(block, base + 18, tensor.quantAxis);
    writeU32(block, base + 20, tensor.groupSize);
    writeU32(block, base + 24, tensor.scaleIndex >>> 0);
    writeU32(block, base + 28, tensor.outerIndex >>> 0);
    writeU64n(block, base + 32, tensor.byteOffset);
    writeU64n(block, base + 40, tensor.byteLength);
    for (let dim = 0; dim < 8; dim++) {
      writeU64n(block, base + 48 + dim * 8, tensor.shape[dim]);
    }
  }
  if (heapLen) {
    let heapAt = HEADER + count * DESC;
    for (const tensor of prepared) {
      if (tensor.name.length) {
        block.set(tensor.name, heapAt);
        heapAt += tensor.name.length;
      }
    }
    for (const tensor of prepared) {
      if (tensor.layout.length) {
        block.set(tensor.layout, heapAt);
        heapAt += tensor.layout.length;
      }
    }
  }
  for (const tensor of prepared) {
    block.set(tensor.data, payloadBase + tensor.byteOffset);
  }
  return block.length === size ? block : block.subarray(0, size);
}

interface RawTensor {
  dtype: number;
  rank: number;
  reserved: number;
  nameOff: number;
  nameLen: number;
  layoutOff: number;
  layoutLen: number;
  blockSize: number;
  quantScheme: number;
  quantAxis: number;
  groupSize: number;
  scaleIndex: number;
  outerIndex: number;
  byteOffset: number;
  byteLength: number;
  shape: number[];
  name: Uint8Array;
  layout: Uint8Array;
  nameText: string | null;
  layoutText: string | null;
  data: Uint8Array;
}

function mustUtf8(bytes: Uint8Array, trusted: boolean): string {
  if (trusted) {
    return utf8Loose.decode(bytes);
  }
  try {
    return utf8Fatal.decode(bytes);
  } catch {
    throw new KilnError("UTF8");
  }
}

function byteKey(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("latin1");
}

function checkTensor(item: RawTensor): void {
  const { dtype, rank } = item;
  if (rank > 8) {
    throw new KilnError("TYPE");
  }
  for (let dim = rank; dim < 8; dim++) {
    if (item.shape[dim] !== 0) {
      throw new KilnError("TYPE");
    }
  }
  if (dtype === 0 || (dtype >= 20 && dtype < OPAQUE_MIN) || dtype > OPAQUE_MAX) {
    throw new KilnError("TYPE");
  }
  const count = elementCount(rank, item.shape);
  if (dtype >= OPAQUE_MIN) {
    if (item.layout.length === 0 || item.blockSize === 0) {
      throw new KilnError("TYPE");
    }
    if (item.byteLength % item.blockSize !== 0) {
      throw new KilnError("TYPE");
    }
    return;
  }
  if (item.layout.length !== 0 || item.blockSize !== 0) {
    throw new KilnError("TYPE");
  }
  if (item.byteLength !== expectedBytes(dtype, count)) {
    throw new KilnError("TYPE");
  }
}

function checkQuant(tensors: RawTensor[]): void {
  for (let index = 0; index < tensors.length; index++) {
    const item = tensors[index];
    const scheme = item.quantScheme;
    if (scheme === 0) {
      if (
        item.groupSize !== 0 ||
        item.quantAxis !== 0xffff ||
        item.scaleIndex !== 0xffffffff ||
        item.outerIndex !== 0xffffffff
      ) {
        throw new KilnError("TYPE");
      }
      continue;
    }
    if (scheme !== 1 && scheme !== 2) {
      throw new KilnError("TYPE");
    }
    if (item.rank === 0 || item.quantAxis >= item.rank || item.groupSize === 0) {
      throw new KilnError("TYPE");
    }
    const scale = item.scaleIndex;
    if (scale === index || scale >= tensors.length) {
      throw new KilnError("TYPE");
    }
    const other = tensors[scale];
    if (other.quantScheme !== 0) {
      throw new KilnError("TYPE");
    }
    const axis = item.shape[item.quantAxis];
    const groups = Math.floor((axis + item.groupSize - 1) / item.groupSize);
    let otherDims = 1;
    for (let dim = 0; dim < item.rank; dim++) {
      if (dim !== item.quantAxis) {
        otherDims = mul64n(otherDims, item.shape[dim]);
      }
    }
    if (elementCount(other.rank, other.shape) !== mul64n(groups, otherDims)) {
      throw new KilnError("TYPE");
    }
    if (scheme === 1) {
      if (item.outerIndex !== 0xffffffff) {
        throw new KilnError("TYPE");
      }
      continue;
    }
    const outer = item.outerIndex;
    if (outer === index || outer === scale || outer >= tensors.length) {
      throw new KilnError("TYPE");
    }
    const outerItem = tensors[outer];
    if (
      outerItem.quantScheme !== 0 ||
      outerItem.dtype !== DTYPE.f32 ||
      elementCount(outerItem.rank, outerItem.shape) !== 1
    ) {
      throw new KilnError("TYPE");
    }
  }
}

export interface DecodeTensorOptions {
  standalone?: boolean;
  cap?: number;
  trusted?: boolean;
}

function decodeSimple(
  buf: Uint8Array,
  standalone: boolean,
  cap: number,
): readonly [TensorDirectory, number] | null {
  if (buf.length < HEADER || buf[4] !== 2 || buf[5] !== FLAG_LE) {
    return null;
  }
  if (readU16(buf, 6) !== 0 || !isZero(buf, 32, 64)) {
    return null;
  }
  const count = readU32(buf, 8);
  const nameBytes = readU32(buf, 12);
  if (nameBytes !== 0 || count > 16 || count > cap) {
    return null;
  }
  const payloadBytes = readU64n(buf, 16);
  const directoryBytes = readU64n(buf, 24);
  if (directoryBytes !== count * DESC) {
    return null;
  }
  const directoryEnd = HEADER + directoryBytes;
  if (directoryEnd > buf.length) {
    return null;
  }
  const payloadBase = align64(directoryEnd);
  const blockEnd = add64n(payloadBase, payloadBytes);
  if (blockEnd > buf.length || !isZero(buf, directoryEnd, payloadBase)) {
    return null;
  }
  const tensors: TensorOut[] = new Array(count);
  let placed = 0;
  for (let index = 0; index < count; index++) {
    const base = HEADER + index * DESC;
    if (!isZero(buf, base + 112, base + 128) || buf[base + 3] !== 0) {
      return null;
    }
    const dtype = readU16(buf, base);
    const rank = buf[base + 2];
    const width = WHOLE[dtype];
    if (width === undefined || dtype === DTYPE.bool || rank > 8) {
      return null;
    }
    if (
      readU16(buf, base + 4) !== 0xffff ||
      readU16(buf, base + 6) !== 0 ||
      readU16(buf, base + 8) !== 0xffff ||
      readU16(buf, base + 10) !== 0 ||
      readU32(buf, base + 12) !== 0 ||
      readU16(buf, base + 16) !== 0 ||
      readU16(buf, base + 18) !== 0xffff ||
      readU32(buf, base + 20) !== 0 ||
      readU32(buf, base + 24) !== 0xffffffff ||
      readU32(buf, base + 28) !== 0xffffffff
    ) {
      return null;
    }
    const off = readU64n(buf, base + 32);
    const len = readU64n(buf, base + 40);
    if (off !== align64(placed)) {
      return null;
    }
    let elems = 1;
    const shape: number[] = [];
    for (let dim = 0; dim < rank; dim++) {
      const axis = readU64n(buf, base + 48 + dim * 8);
      shape.push(axis);
      elems = mul64n(elems, axis);
    }
    for (let dim = rank; dim < 8; dim++) {
      if (readU64n(buf, base + 48 + dim * 8) !== 0) {
        return null;
      }
    }
    if (len !== mul64n(elems, width)) {
      return null;
    }
    const end = off + len;
    if (end > payloadBytes || !isZero(buf, payloadBase + placed, payloadBase + off)) {
      return null;
    }
    tensors[index] = {
      name: null,
      dtype: DTYPE_NAME[dtype],
      shape,
      data: buf.subarray(payloadBase + off, payloadBase + end),
      quant_scheme: 0,
      quant_axis: 0xffff,
      group_size: 0,
      scale_index: 0xffffffff,
      outer_index: 0xffffffff,
      layout: null,
      block_size: 0,
    };
    placed = end;
  }
  if (placed !== payloadBytes || !isZero(buf, payloadBase + placed, payloadBase + payloadBytes)) {
    return null;
  }
  if (standalone && blockEnd !== buf.length) {
    return null;
  }
  return [
    { version: 2, flags: ["le"], tensors, block_length: blockEnd },
    blockEnd,
  ];
}

export function decodeTensors(
  buf: Uint8Array,
  opts: DecodeTensorOptions = {},
): readonly [TensorDirectory, number] {
  const standalone = opts.standalone !== false;
  const cap = opts.cap ?? CAP;
  const trusted = opts.trusted === true;
  if (buf.length >= 4 && buf[0] === 0x4b && buf[1] === 0x4c && buf[2] === 0x4e && buf[3] === 0x54) {
    const simple = decodeSimple(buf, standalone, cap);
    if (simple) {
      return simple;
    }
  }
  if (buf.length < 4) {
    throw new KilnError("EOF");
  }
  if (buf[0] !== 0x4b || buf[1] !== 0x4c || buf[2] !== 0x4e || buf[3] !== 0x54) {
    throw new KilnError("FRAME");
  }
  if (buf.length < HEADER) {
    throw new KilnError("EOF");
  }
  const version = buf[4];
  const flags = buf[5];
  const reserved16 = readU16(buf, 6);
  const count = readU32(buf, 8);
  const nameBytes = readU32(buf, 12);
  const payloadBytes = readU64n(buf, 16);
  const directoryBytes = readU64n(buf, 24);
  if (version !== 2 || (flags & ~0x03) !== 0 || (flags & FLAG_LE) === 0) {
    throw new KilnError("FRAME");
  }
  if (reserved16 !== 0 || !isZero(buf, 32, 64)) {
    throw new KilnError("FRAME");
  }
  if (count > cap || nameBytes > cap) {
    throw new KilnError("LIMIT");
  }
  const expectDir = add64n(mul64n(count, DESC), nameBytes);
  if (directoryBytes !== expectDir) {
    throw new KilnError("TYPE");
  }
  const directoryEnd = add64n(HEADER, directoryBytes);
  if (directoryEnd > buf.length) {
    throw new KilnError("EOF");
  }
  const dirEnd = directoryEnd;
  const payloadBase = align64(directoryEnd);
  const blockEnd = add64n(payloadBase, payloadBytes);
  if (blockEnd > buf.length) {
    throw new KilnError("EOF");
  }
  if (!isZero(buf, dirEnd, payloadBase)) {
    throw new KilnError("TYPE");
  }
  const raw: RawTensor[] = [];
  for (let index = 0; index < count; index++) {
    const base = HEADER + index * DESC;
    if (!isZero(buf, base + 112, base + 128)) {
      throw new KilnError("FRAME");
    }
    const shape: number[] = new Array(8);
    for (let dim = 0; dim < 8; dim++) {
      shape[dim] = readU64n(buf, base + 48 + dim * 8);
    }
    raw.push({
      dtype: readU16(buf, base),
      rank: buf[base + 2],
      reserved: buf[base + 3],
      nameOff: readU16(buf, base + 4),
      nameLen: readU16(buf, base + 6),
      layoutOff: readU16(buf, base + 8),
      layoutLen: readU16(buf, base + 10),
      blockSize: readU32(buf, base + 12),
      quantScheme: readU16(buf, base + 16),
      quantAxis: readU16(buf, base + 18),
      groupSize: readU32(buf, base + 20),
      scaleIndex: readU32(buf, base + 24),
      outerIndex: readU32(buf, base + 28),
      byteOffset: readU64n(buf, base + 32),
      byteLength: readU64n(buf, base + 40),
      shape,
      name: EMPTY,
      layout: EMPTY,
      nameText: null,
      layoutText: null,
      data: EMPTY,
    });
  }
  const heap = buf.subarray(HEADER + count * DESC, dirEnd);
  const namesFlag = (flags & FLAG_NAME) !== 0;
  const hasName = raw.some((item) => item.nameLen !== 0);
  if (namesFlag !== hasName || (namesFlag && raw.some((item) => item.nameLen === 0))) {
    throw new KilnError("TYPE");
  }
  const parts: Uint8Array[] = [];
  const layouts: Uint8Array[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (item.reserved !== 0) {
      throw new KilnError("FRAME");
    }
    if (item.nameLen === 0) {
      if (item.nameOff !== 0xffff) {
        throw new KilnError("TYPE");
      }
    } else {
      if (item.nameOff === 0xffff) {
        throw new KilnError("TYPE");
      }
      const end = add64n(item.nameOff, item.nameLen);
      if (end > nameBytes) {
        throw new KilnError("TYPE");
      }
      const name = heap.subarray(item.nameOff, end);
      const text = mustUtf8(name, trusted);
      const key = byteKey(name);
      if (seen.has(key)) {
        throw new KilnError("TYPE");
      }
      seen.add(key);
      parts.push(name);
      item.name = name;
      item.nameText = text;
    }
    if (item.layoutLen === 0) {
      if (item.layoutOff !== 0xffff) {
        throw new KilnError("TYPE");
      }
    } else {
      const end = add64n(item.layoutOff, item.layoutLen);
      if (end > nameBytes) {
        throw new KilnError("TYPE");
      }
      const layout = heap.subarray(item.layoutOff, end);
      item.layoutText = mustUtf8(layout, trusted);
      layouts.push(layout);
      item.layout = layout;
    }
  }
  let expectHeap = 0;
  for (const part of parts) {
    expectHeap += part.length;
  }
  for (const part of layouts) {
    expectHeap += part.length;
  }
  if (expectHeap !== heap.length) {
    throw new KilnError("TYPE");
  }
  let at = 0;
  for (const part of parts) {
    for (let i = 0; i < part.length; i++) {
      if (heap[at + i] !== part[i]) {
        throw new KilnError("TYPE");
      }
    }
    at += part.length;
  }
  for (const part of layouts) {
    for (let i = 0; i < part.length; i++) {
      if (heap[at + i] !== part[i]) {
        throw new KilnError("TYPE");
      }
    }
    at += part.length;
  }
  const ranges: Array<[number, number]> = [];
  for (const item of raw) {
    const itemEnd = add64n(item.byteOffset, item.byteLength);
    if (itemEnd > payloadBytes) {
      throw new KilnError("TYPE");
    }
    ranges.push([item.byteOffset, itemEnd]);
    checkTensor(item);
  }
  for (let left = 0; left < ranges.length; left++) {
    const [a0, a1] = ranges[left];
    for (let right = left + 1; right < ranges.length; right++) {
      const [b0, b1] = ranges[right];
      if (a0 === a1 || b0 === b1) {
        continue;
      }
      if (a0 < b1 && b0 < a1) {
        throw new KilnError("TYPE");
      }
    }
  }
  let placed = 0;
  for (const item of raw) {
    if (item.byteOffset !== align64(placed)) {
      throw new KilnError("TYPE");
    }
    placed = item.byteOffset + item.byteLength;
  }
  if (placed !== payloadBytes) {
    throw new KilnError("TYPE");
  }
  const payload = buf.subarray(payloadBase, blockEnd);
  for (const item of raw) {
    const off = item.byteOffset;
    const len = item.byteLength;
    const region = payload.subarray(off, off + len);
    if (PACKED.has(item.dtype)) {
      const countElems = elementCount(item.rank, item.shape);
      if (countElems % 2 === 1 && region.length !== 0 && (region[region.length - 1] >> 4) !== 0) {
        throw new KilnError("TYPE");
      }
    }
    if (item.dtype === DTYPE.bool) {
      for (let i = 0; i < region.length; i++) {
        if (region[i] > 1) {
          throw new KilnError("TYPE");
        }
      }
    }
    item.data = region;
  }
  let cursor = 0;
  for (const item of raw) {
    const off = item.byteOffset;
    if (!isZero(payload, cursor, off)) {
      throw new KilnError("TYPE");
    }
    cursor = off + item.byteLength;
  }
  if (!isZero(payload, cursor, payload.length)) {
    throw new KilnError("TYPE");
  }
  if (!trusted) {
    checkQuant(raw);
  }
  if (standalone && blockEnd !== buf.length) {
    throw new KilnError("TRAILING");
  }
  const tensors: TensorOut[] = [];
  for (const item of raw) {
    const shape = item.shape.slice(0, item.rank);
    tensors.push({
      name: item.nameText,
      dtype: DTYPE_NAME[item.dtype] ?? item.dtype,
      shape,
      data: item.data,
      quant_scheme: item.quantScheme,
      quant_axis: item.quantAxis,
      group_size: item.groupSize,
      scale_index: item.scaleIndex,
      outer_index: item.outerIndex,
      layout: item.layoutText,
      block_size: item.blockSize,
    });
  }
  return [
    {
      version: 2,
      flags: namesFlag ? ["names", "le"] : ["le"],
      tensors,
      block_length: blockEnd,
    },
    blockEnd,
  ];
}
