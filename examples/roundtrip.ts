import { Writer, decode } from "../src/index.ts";

const point = ["struct", [["x", ["i32"]], ["y", ["i32"]]]] as const;
const writer = new Writer(64);
const raw = writer.encode(point, { x: 9, y: -4 });
console.log(decode(point, raw), raw.byteLength);
