import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { emit } from "../src/codegen.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pointText = readFileSync(join(root, "testdata/schema/point.json"), "utf8");
const messageText = readFileSync(join(root, "testdata/schema/message.json"), "utf8");
const indexUrl = pathToFileURL(join(root, "src/index.ts")).href;

function rewrite(source: string): string {
  return source.replaceAll('from "gld-kiln"', `from ${JSON.stringify(indexUrl)}`);
}

test("generator output is stable", () => {
  assert.equal(emit(pointText), emit(pointText));
  assert.equal(emit(messageText), emit(messageText));
});

test("generated Point round-trips", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kiln-point-"));
  const file = join(dir, "point.ts");
  writeFileSync(file, rewrite(emit(pointText)));
  const mod = await import(pathToFileURL(file).href);
  const point = new mod.Point();
  point.x = 3;
  point.y = -1;
  point.label = "n";
  const back = mod.Point.decode(point.encode());
  assert.equal(back.x, 3);
  assert.equal(back.y, -1);
  assert.equal(back.label, "n");
  assert.equal(mod.Point.encodedSize(point.toValue()), point.encode().byteLength);
});

test("generated Message round-trips", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kiln-message-"));
  const file = join(dir, "message.ts");
  writeFileSync(file, rewrite(emit(messageText)));
  const mod = await import(pathToFileURL(file).href);
  const message = new mod.Message();
  message.f_bool = true;
  message.f_int32 = -2;
  message.f_int64 = 99;
  message.f_float64 = 1.5;
  message.f_string = "hello";
  message.f_bool_2 = false;
  message.f_int32_2 = 7;
  message.f_string_2 = "world";
  message.meta.region = "us";
  message.meta.flag = true;
  const back = mod.Message.decode(message.encode());
  assert.equal(back.f_string, "hello");
  assert.equal(back.f_string_2, "world");
  assert.equal(back.meta.region, "us");
  assert.equal(back.meta.flag, true);
  assert.equal(back.f_int64, 99);
});
