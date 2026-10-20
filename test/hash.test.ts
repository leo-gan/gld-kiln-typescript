import assert from "node:assert/strict";
import { test } from "node:test";
import { typeHash } from "../src/hashing.ts";
import { schemaFromCase, schemaFromJson } from "../src/schema.ts";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("frame schema hash matches the recorded case", () => {
  const schema = schemaFromCase("frame");
  assert.equal(typeHash(schema), 16540223653110812034n);
});

test("point json schema names the optional label", () => {
  const text = readFileSync(join(root, "testdata/schema/point.json"), "utf8");
  const [title, schema] = schemaFromJson(text);
  assert.equal(title, "Point");
  assert.equal(schema[0], "struct");
  assert.equal(schema[2], "Point");
  const fields = schema[1] as Array<[string, readonly [string, ...unknown[]]]>;
  assert.deepEqual(fields[2], ["label", ["opt", ["str"]]]);
});
