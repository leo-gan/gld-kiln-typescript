#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { emit } from "./codegen.ts";

const argv = process.argv.slice(2);
let output = "";
const positional: string[] = [];
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg === "-o" || arg === "--output") {
    output = argv[++i] ?? "";
    continue;
  }
  if (arg === "-h" || arg === "--help") {
    console.log("usage: gld-kilngen-typescript SCHEMA -o OUTPUT");
    process.exit(0);
  }
  positional.push(arg);
}
if (positional.length !== 1 || !output) {
  console.error("usage: gld-kilngen-typescript SCHEMA -o OUTPUT");
  process.exit(2);
}
writeFileSync(output, emit(readFileSync(positional[0], "utf8")));
