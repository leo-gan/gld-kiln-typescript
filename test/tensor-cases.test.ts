import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { KilnError } from "../src/error.ts";
import { decodeTensors, encodeTensors } from "../src/tensor.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const doc = JSON.parse(readFileSync(join(root, "testdata/kiln-v2-cases.json"), "utf8"));

function project(directory: { version: number; flags: string[]; tensors: Array<Record<string, unknown>>; block_length: number }) {
  return {
    version: directory.version,
    flags: directory.flags,
    tensors: directory.tensors.map((item) => ({
      name: item.name,
      dtype: item.dtype,
      shape: item.shape,
      quant_scheme: item.quant_scheme,
      data_hex: Buffer.from(item.data as Uint8Array).toString("hex"),
    })),
    block_length: directory.block_length,
  };
}

for (const entry of doc.cases as Array<Record<string, unknown>>) {
  if (entry.schema !== "tensor-v2") {
    continue;
  }
  test(`tensor ${entry.id}`, () => {
    const raw = Buffer.from(String(entry.input), "hex");
    if (entry.expect === "reject") {
      assert.throws(
        () => decodeTensors(raw),
        (err: unknown) => {
          assert.ok(err instanceof KilnError);
          assert.equal(err.code, entry.error);
          return true;
        },
      );
      return;
    }
    const [decoded] = decodeTensors(raw);
    if (entry.decoded) {
      assert.deepEqual(project(decoded), entry.decoded);
    }
    const again = encodeTensors(decoded.tensors);
    assert.equal(Buffer.from(again).toString("hex"), entry.input);
  });
}
