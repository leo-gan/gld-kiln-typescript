/** FNV-1a 64 schema hash. Each token is mixed, then a 0x00 step. */

import { KilnError } from "./error.ts";
import type { Schema } from "./schema.ts";

const FNV_OFFSET = 14695981039346656037n;
const FNV_PRIME = 1099511628211n;
const MASK = 0xffffffffffffffffn;

const SCALARS = new Set([
  "bool",
  "i8",
  "i16",
  "i32",
  "i64",
  "int",
  "u8",
  "u16",
  "u32",
  "u64",
  "uint",
  "f32",
  "f64",
  "str",
  "bytes",
  "tensors",
]);

const utf8 = new TextEncoder();
const tokens = new Map<string, Uint8Array>();

function ascii(text: string): Uint8Array {
  let cached = tokens.get(text);
  if (!cached) {
    cached = utf8.encode(text);
    tokens.set(text, cached);
  }
  return cached;
}

function mix(hashValue: bigint, data: Uint8Array): bigint {
  let h = hashValue;
  for (let i = 0; i < data.length; i++) {
    h ^= BigInt(data[i]);
    h = (h * FNV_PRIME) & MASK;
  }
  // Trailing 0x00 is a multiply: xor with zero does not change the hash.
  return (h * FNV_PRIME) & MASK;
}

function hashSchema(hashValue: bigint, schema: Schema): bigint {
  const kind = schema[0];
  if (SCALARS.has(kind)) {
    return mix(hashValue, ascii(kind));
  }
  if (kind === "list") {
    let h = mix(hashValue, ascii("list<"));
    h = hashSchema(h, schema[1] as Schema);
    return mix(h, ascii(">"));
  }
  if (kind === "opt") {
    let h = mix(hashValue, ascii("opt<"));
    h = hashSchema(h, schema[1] as Schema);
    return mix(h, ascii(">"));
  }
  if (kind === "dict") {
    let h = mix(hashValue, ascii("dict<str,"));
    h = hashSchema(h, schema[1] as Schema);
    return mix(h, ascii(">"));
  }
  if (kind === "struct") {
    let h = mix(hashValue, ascii("struct{"));
    const fields = schema[1] as ReadonlyArray<readonly [string, Schema]>;
    for (const [name, field] of fields) {
      h = mix(h, utf8.encode(name));
      h = mix(h, ascii(":"));
      h = hashSchema(h, field);
      h = mix(h, ascii(","));
    }
    return mix(h, ascii("}"));
  }
  throw new KilnError("TYPE");
}

export function typeHash(schema: Schema): bigint {
  return hashSchema(FNV_OFFSET, schema);
}
