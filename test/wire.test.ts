import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { FloatBits } from "../src/binary.ts";
import { KilnError } from "../src/error.ts";
import { decode, decodeFramed, encode, encodeFramed } from "../src/frozen.ts";
import { schemaFromCase, type Schema } from "../src/schema.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const POINT: Schema = ["struct", [["x", ["i32"]], ["y", ["i32"]]]];
const MESSAGE: Schema = [
  "struct",
  [
    ["f_bool", ["bool"]],
    ["f_int32", ["i32"]],
    ["f_int64", ["i64"]],
    ["f_float64", ["f64"]],
    ["f_string", ["str"]],
    ["f_bool_2", ["bool"]],
    ["f_int32_2", ["i32"]],
    ["f_string_2", ["str"]],
  ],
];

function refPacks(): Record<string, { raw: string; framed: string }> {
  const script = `
import json, struct, sys
sys.path.insert(0, ${JSON.stringify(join(root, "testdata/reference"))})
import kiln_ref
nan = struct.unpack("<d", bytes.fromhex("010000000000f87f"))[0]
def pack(schema, value):
    return {"raw": kiln_ref.encode(schema, value).hex(), "framed": kiln_ref.encode_framed(schema, value).hex()}
message = {
    "f_bool": True, "f_int32": -2, "f_int64": 99, "f_float64": 1.5,
    "f_string": "hello", "f_bool_2": False, "f_int32_2": 7, "f_string_2": "world",
}
out = {
    "point": pack(kiln_ref.POINT, {"x": 9, "y": -4}),
    "message": pack(kiln_ref.MESSAGE, message),
    "list": pack(("list", ("i32",)), [1, 2, 3]),
    "opt0": pack(("opt", ("str",)), None),
    "opt1": pack(("opt", ("str",)), "z"),
    "dict": pack(("dict", ("i32",)), {"b": 2, "a": 1}),
    "neg": pack(("list", ("f64",)), [-0.0, 1.0]),
    "nan": pack(("f64",), nan),
}
print(json.dumps(out))
`;
  const result = spawnSync("python3", ["-c", script], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function roundTrip(schema: Schema, value: unknown, rawHex: string, framedHex: string): void {
  const raw = Buffer.from(rawHex, "hex");
  assert.deepEqual(decode(schema, raw), value);
  assert.equal(Buffer.from(encode(schema, value)).toString("hex"), rawHex);
  const framed = Buffer.from(framedHex, "hex");
  assert.deepEqual(decodeFramed(schema, framed), value);
  assert.equal(Buffer.from(encodeFramed(schema, value)).toString("hex"), framedHex);
}

test("reference point, message, lists, opts, dicts, and frames", () => {
  const packs = refPacks();
  roundTrip(POINT, { x: 9, y: -4 }, packs.point.raw, packs.point.framed);
  roundTrip(
    MESSAGE,
    {
      f_bool: true,
      f_int32: -2,
      f_int64: 99,
      f_float64: 1.5,
      f_string: "hello",
      f_bool_2: false,
      f_int32_2: 7,
      f_string_2: "world",
    },
    packs.message.raw,
    packs.message.framed,
  );
  roundTrip(["list", ["i32"]], [1, 2, 3], packs.list.raw, packs.list.framed);
  roundTrip(["opt", ["str"]], null, packs.opt0.raw, packs.opt0.framed);
  roundTrip(["opt", ["str"]], "z", packs.opt1.raw, packs.opt1.framed);
  roundTrip(["dict", ["i32"]], { a: 1, b: 2 }, packs.dict.raw, packs.dict.framed);
  const neg = Buffer.from(packs.neg.raw, "hex");
  const negValue = decode(["list", ["f64"]], neg) as number[];
  assert.equal(Object.is(negValue[0], -0), true);
  assert.equal(negValue[1], 1);
  assert.equal(Buffer.from(encode(["list", ["f64"]], negValue)).toString("hex"), packs.neg.raw);
  const nanRaw = Buffer.from(packs.nan.raw, "hex");
  const nanValue = decode(["f64"], nanRaw);
  assert.equal(nanValue instanceof FloatBits || Number.isNaN(nanValue), true);
  assert.equal(Buffer.from(encode(["f64"], nanValue)).toString("hex"), packs.nan.raw);
  assert.equal(Buffer.from(encodeFramed(["f64"], nanValue)).toString("hex"), packs.nan.framed);
});

test("negative zero and nan payload", () => {
  const schema: Schema = ["list", ["f64"]];
  const payload = Buffer.alloc(16);
  payload.writeDoubleLE(-0, 0);
  payload.write(Buffer.from("010000000000f87f", "hex").toString("binary"), 8, "binary");
  const raw = Buffer.concat([Buffer.from([2, 0, 0, 0]), payload]);
  const got = decode(schema, raw) as [number, number | FloatBits];
  assert.equal(Object.is(got[0], -0), true);
  assert.equal(got[1] instanceof FloatBits || Number.isNaN(got[1]), true);
  assert.equal(Buffer.from(encode(schema, got)).toString("hex"), raw.toString("hex"));
  const back = Buffer.alloc(8);
  if (got[1] instanceof FloatBits) {
    back.writeBigUint64LE(got[1].bits);
  } else {
    back.writeDoubleLE(got[1], 0);
  }
  assert.equal(back.toString("hex"), "010000000000f87f");
});

test("dict key order and opt", () => {
  const schema: Schema = ["dict", ["i32"]];
  const raw = encode(schema, { b: 2, a: 1 });
  assert.deepEqual(decode(schema, raw), { a: 1, b: 2 });
  const opt: Schema = ["opt", ["str"]];
  assert.equal(decode(opt, encode(opt, null)), null);
  assert.equal(decode(opt, encode(opt, "z")), "z");
});

test("hostile list does not allocate", () => {
  const schema = schemaFromCase({ type: "list", element: "struct{a:i64}" });
  assert.throws(
    () => decode(schema, Buffer.from("00000001", "hex")),
    (err: unknown) => {
      assert.ok(err instanceof KilnError);
      assert.equal(err.code, "EOF");
      return true;
    },
  );
});
