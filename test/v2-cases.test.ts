import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { KilnError } from "../src/error.ts";
import { decode, decodeFramed, encode, encodeFramed } from "../src/frozen.ts";
import { typeHash } from "../src/hashing.ts";
import { schemaFromCase } from "../src/schema.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const text = readFileSync(join(root, "testdata/kiln-v2-cases.json"), "utf8");
const doc = JSON.parse(text.replace(/("hash"\s*:\s*)(\d+)/g, '$1"$2"')) as {
  cases: Array<Record<string, unknown>>;
};

function isDirectory(value: unknown): value is {
  version: number;
  flags: string[];
  tensors: Array<Record<string, unknown>>;
  block_length: number;
} {
  return !!value && typeof value === "object" && "tensors" in value && "block_length" in value;
}

function project(value: unknown): unknown {
  if (isDirectory(value)) {
    return {
      version: value.version,
      flags: value.flags,
      tensors: value.tensors.map((item) => ({
        name: item.name,
        dtype: item.dtype,
        shape: item.shape,
        quant_scheme: item.quant_scheme,
        data_hex: Buffer.from(item.data as Uint8Array).toString("hex"),
      })),
      block_length: value.block_length,
    };
  }
  if (Array.isArray(value)) {
    return value.map(project);
  }
  if (value && typeof value === "object" && !(value instanceof Uint8Array)) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = project(item);
    }
    return out;
  }
  return value;
}

function same(got: unknown, want: unknown): boolean {
  if (typeof want === "number" && typeof got === "number") {
    if (Number.isNaN(want) && Number.isNaN(got)) {
      return true;
    }
    return Object.is(got, want);
  }
  if (Array.isArray(want) && Array.isArray(got)) {
    return want.length === got.length && want.every((item, i) => same(got[i], item));
  }
  if (want && typeof want === "object" && got && typeof got === "object" && !Array.isArray(want)) {
    const left = got as Record<string, unknown>;
    const right = want as Record<string, unknown>;
    return Object.keys(right).every((key) => key in left && same(left[key], right[key]));
  }
  return got === want;
}

test("kiln-v2-cases.json loads", () => {
  assert.equal(doc.cases.length, 46);
});

for (const entry of doc.cases) {
  test(`v2 ${entry.id}`, () => {
    const raw = Buffer.from(String(entry.input), "hex");
    const schema = schemaFromCase(entry.schema);
    const framed = entry.schema === "frame";
    if (entry.expect === "reject") {
      assert.throws(
        () => (framed ? decodeFramed(schema, raw) : decode(schema, raw)),
        (err: unknown) => {
          assert.ok(err instanceof KilnError);
          assert.equal(err.code, entry.error);
          return true;
        },
      );
      return;
    }
    const value = framed ? decodeFramed(schema, raw) : decode(schema, raw);
    if ("decoded" in entry) {
      const decoded = entry.decoded as Record<string, unknown>;
      let want: unknown = decoded;
      if (framed) {
        assert.equal(typeHash(schema), BigInt(decoded.hash as string));
        want = { id: decoded.id, batch: decoded.batch };
      }
      assert.equal(same(project(value), want), true);
    }
    const again = framed ? encodeFramed(schema, value) : encode(schema, value);
    assert.equal(Buffer.from(again).toString("hex"), entry.input);
  });
}
