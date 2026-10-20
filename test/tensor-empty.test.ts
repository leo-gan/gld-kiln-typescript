import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeTensors } from "../src/tensor.ts";

test("empty directory is the 64-byte header", () => {
  const raw = encodeTensors([]);
  assert.equal(
    Buffer.from(raw).toString("hex"),
    "4b4c4e54020200000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
  );
});
