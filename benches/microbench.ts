import { Writer, decode, decodeTensors, encodeTensors } from "../src/index.ts";
import type { Schema } from "../src/schema.ts";

const POINT: Schema = ["struct", [["x", ["i32"]], ["y", ["i32"]], ["label", ["str"]]]];
const VALUE = { x: 9, y: -4, label: "item" };
const ones = new Float32Array(1024);
ones.fill(1);
const TENSOR = [{ dtype: "f32" as const, shape: [1024], data: new Uint8Array(ones.buffer) }];

function bench(fn: () => void, n = 20000, warm = 500): number {
  for (let i = 0; i < warm; i++) {
    fn();
  }
  const start = process.hrtime.bigint();
  for (let i = 0; i < n; i++) {
    fn();
  }
  return Number(process.hrtime.bigint() - start) / n;
}

const writer = new Writer(256);
const block = Uint8Array.from(encodeTensors(TENSOR));
const sink = new Uint8Array(8192);

function enc(): void {
  writer.encode(POINT, VALUE);
}

function dec(): void {
  decode(POINT, writer.buf.subarray(0, writer.end));
}

writer.encode(POINT, VALUE);
console.log("struct_encode_ns", Math.round(bench(enc)));
console.log("struct_decode_ns", Math.round(bench(dec)));
console.log("struct_bytes", writer.end);
console.log("tensor_encode_ns", Math.round(bench(() => encodeTensors(TENSOR), 4000, 200)));
console.log("tensor_encode_reuse_ns", Math.round(bench(() => encodeTensors(TENSOR, sink), 4000, 200)));
console.log("tensor_decode_ns", Math.round(bench(() => decodeTensors(block), 4000, 200)));
console.log("tensor_bytes", block.byteLength);
