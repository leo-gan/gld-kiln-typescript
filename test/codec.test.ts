import assert from "node:assert/strict";
import { test } from "node:test";
import { FloatBits, KilnError, Writer, compile, decode, encode, type Schema } from "../src/index.ts";

const DOCUMENT: Schema = [
  "struct",
  [
    ["id", ["str"]],
    ["status", ["i32"]],
    ["meta", ["struct", [["region", ["str"]], ["version", ["i32"]]]]],
    [
      "items",
      ["list", ["struct", [["sku", ["str"]], ["qty", ["i32"]], ["price_minor", ["i64"]]]]],
    ],
  ],
];

const TELEMETRY: Schema = [
  "struct",
  [
    ["source", ["str"]],
    ["ts", ["i64"]],
    ["tags", ["list", ["str"]]],
    ["values", ["list", ["f64"]]],
  ],
];

const COMPLEX: Schema = [
  "struct",
  [
    ["flag", ["bool"]],
    ["note", ["opt", ["str"]]],
    ["raw", ["bytes"]],
    ["bigs", ["list", ["i64"]]],
    ["ubigs", ["list", ["u64"]]],
  ],
];

test("compiled codec matches encode/decode on nested structs and lists", () => {
  const doc = {
    id: "doc-0001-long-identifier-over-16-bytes",
    status: 200,
    meta: { region: "us-east-1", version: 3 },
    items: [
      { sku: "sku-1", qty: 2, price_minor: 1999 },
      { sku: "café-🚀-item-with-multibyte-utf8-text", qty: -5, price_minor: -9007199254740991 },
    ],
  };
  const codec = compile(DOCUMENT);
  const bytes = codec.encode(doc);
  assert.equal(Buffer.from(bytes).toString("hex"), Buffer.from(encode(DOCUMENT, doc)).toString("hex"));
  assert.deepEqual(codec.decode(bytes), doc);
  assert.deepEqual(codec.decode(new Uint8Array(bytes)), doc);

  const writer = new Writer(16);
  const viaWriter = codec.encodeInto(writer, doc);
  assert.equal(Buffer.from(viaWriter).toString("hex"), Buffer.from(bytes).toString("hex"));
});

test("compiled codec handles Float64Array, safe-int edges, BigInt, opt, bytes, and ASCII lengths 0..24", () => {
  const telCodec = compile(TELEMETRY);
  const tel = {
    source: "sensor-alpha-01",
    ts: 1700000000000,
    tags: Array.from({ length: 25 }, (_, i) => "a".repeat(i)),
    values: [-0.0, 0.0, 1.5, -1e100, Number.POSITIVE_INFINITY],
  };
  const rawArr = Uint8Array.from(telCodec.encode(tel));
  const rawTyped = Uint8Array.from(
    telCodec.encode({ ...tel, values: Float64Array.from(tel.values) }),
  );
  assert.equal(Buffer.from(rawTyped).toString("hex"), Buffer.from(rawArr).toString("hex"));
  const decoded = telCodec.decode(rawArr) as typeof tel;
  assert.equal(Object.is(decoded.values[0], -0), true);
  assert.deepEqual(decoded.tags, tel.tags);

  const complexCodec = compile(COMPLEX);
  const bigVal = {
    flag: true,
    note: null,
    raw: new Uint8Array([1, 2, 3, 255]),
    bigs: [0, -1, -4294967296, -4294967297, 9007199254740991, -9007199254740991, 9007199254740993n, -9007199254740993n],
    ubigs: [0, 1, 4294967296, 9007199254740991, (1n << 64n) - 1n],
  };
  const cbytes = complexCodec.encode(bigVal);
  const cdec = complexCodec.decode(cbytes) as typeof bigVal;
  assert.deepEqual(cdec, bigVal);

  const withNote = { ...bigVal, note: "present-unicode-日本語" };
  assert.deepEqual(complexCodec.decode(complexCodec.encode(withNote)), withNote);
});

test("compiled codec rejects invalid UTF-8, trailing bytes, bad bool, and hostile counts", () => {
  const strCodec = compile(["str"]);
  assert.throws(
    () => strCodec.decode(new Uint8Array([2, 0, 0, 0, 0xff, 0xfe])),
    (err: unknown) => err instanceof KilnError && err.code === "UTF8",
  );
  assert.throws(
    () => strCodec.decode(new Uint8Array([1, 0, 0, 0, 0x61, 0x00])),
    (err: unknown) => err instanceof KilnError && err.code === "TRAILING",
  );

  const boolCodec = compile(["bool"]);
  assert.throws(
    () => boolCodec.decode(new Uint8Array([2])),
    (err: unknown) => err instanceof KilnError && err.code === "TYPE",
  );

  const listCodec = compile(["list", ["i64"]]);
  assert.throws(
    () => listCodec.decode(new Uint8Array([0, 0, 0, 1])),
    (err: unknown) => err instanceof KilnError && err.code === "EOF",
  );
  assert.throws(
    () => listCodec.decode(new Uint8Array([1, 0, 0, 1])),
    (err: unknown) => err instanceof KilnError && err.code === "LIMIT",
  );

  const nanRaw = Buffer.from("010000000000f87f", "hex");
  const f64Codec = compile(["f64"]);
  const got = f64Codec.decode(nanRaw);
  assert.ok(got instanceof FloatBits);
  assert.equal(Buffer.from(f64Codec.encode(got)).toString("hex"), "010000000000f87f");
  assert.equal(Buffer.from(decode(["f64"], nanRaw) instanceof FloatBits ? encode(["f64"], got) : new Uint8Array()).toString("hex"), "010000000000f87f");
});
