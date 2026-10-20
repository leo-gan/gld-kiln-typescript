/** Emit TypeScript classes from the JSON Schema subset. */

import { schemaFromJson, type Field, type Schema } from "./schema.ts";

const TS: Record<string, string> = {
  bool: "boolean",
  i8: "number",
  i16: "number",
  i32: "number",
  i64: "number",
  int: "number",
  u8: "number",
  u16: "number",
  u32: "number",
  u64: "number",
  uint: "number",
  f32: "number",
  f64: "number",
  str: "string",
  bytes: "Uint8Array",
};

function tsType(schema: Schema): string {
  const kind = schema[0];
  if (TS[kind]) {
    return TS[kind];
  }
  if (kind === "list") {
    return `${tsType(schema[1] as Schema)}[]`;
  }
  if (kind === "opt") {
    return `${tsType(schema[1] as Schema)} | null`;
  }
  if (kind === "dict") {
    return `Record<string, ${tsType(schema[1] as Schema)}>`;
  }
  if (kind === "struct") {
    return String(schema[2] ?? "Record<string, unknown>");
  }
  return "unknown";
}

function named(schema: Schema, name: string): Schema {
  if (schema[0] !== "struct") {
    return schema;
  }
  return ["struct", schema[1], name];
}

function collect(schema: Schema, out: Schema[]): void {
  const kind = schema[0];
  if (kind === "list" || kind === "opt" || kind === "dict") {
    collect(schema[1] as Schema, out);
    return;
  }
  if (kind !== "struct") {
    return;
  }
  for (const [, field] of schema[1] as readonly Field[]) {
    collect(field, out);
  }
  out.push(schema);
}

function defaultExpr(schema: Schema): string {
  const kind = schema[0];
  if (kind === "bool") {
    return "false";
  }
  if (kind === "str") {
    return '""';
  }
  if (kind === "bytes") {
    return "new Uint8Array()";
  }
  if (kind === "f32" || kind === "f64") {
    return "0";
  }
  if (kind === "list") {
    return "[]";
  }
  if (kind === "dict") {
    return "{}";
  }
  if (kind === "opt") {
    return "null";
  }
  if (kind === "struct") {
    return `new ${tsType(schema)}()`;
  }
  return "0";
}

function emitSchema(schema: Schema): string {
  const kind = schema[0];
  if (kind === "list" || kind === "opt" || kind === "dict") {
    return `["${kind}", ${emitSchema(schema[1] as Schema)}]`;
  }
  if (kind === "struct") {
    const fields = (schema[1] as readonly Field[])
      .map(([name, field]) => `[${JSON.stringify(name)}, ${emitSchema(field)}]`)
      .join(", ");
    return `["struct", [${fields}]]`;
  }
  return `["${kind}"]`;
}

function toValueExpr(fname: string, schema: Schema): string {
  if (schema[0] === "struct") {
    return `this.${fname}.toValue()`;
  }
  if (schema[0] === "opt" && (schema[1] as Schema)[0] === "struct") {
    return `this.${fname} === null ? null : this.${fname}.toValue()`;
  }
  if (schema[0] === "list" && (schema[1] as Schema)[0] === "struct") {
    return `this.${fname}.map((item) => item.toValue())`;
  }
  return `this.${fname}`;
}

function fromValueExpr(fname: string, schema: Schema): string {
  const access = `value[${JSON.stringify(fname)}]`;
  if (schema[0] === "struct") {
    return `${schema[2]}.fromValue(${access} as Record<string, unknown>)`;
  }
  if (schema[0] === "opt" && (schema[1] as Schema)[0] === "struct") {
    const child = (schema[1] as Schema)[2];
    return `${access} == null ? null : ${child}.fromValue(${access} as Record<string, unknown>)`;
  }
  if (schema[0] === "list" && (schema[1] as Schema)[0] === "struct") {
    const child = (schema[1] as Schema)[2];
    return `(${access} as Record<string, unknown>[]).map((item) => ${child}.fromValue(item))`;
  }
  return `${access} as ${tsType(schema)}`;
}

export function emit(text: string): string {
  const [title, root0] = schemaFromJson(text);
  if (root0[0] !== "struct") {
    throw new Error("root must be an object");
  }
  const root = named(root0, title);
  const structs: Schema[] = [];
  collect(root, structs);
  const lines = ['import { decode, encode } from "gld-kiln";', ""];
  for (const schema of structs) {
    const name = String(schema[2]);
    const fields = schema[1] as readonly Field[];
    lines.push(`export class ${name} {`);
    for (const [fname, fschema] of fields) {
      lines.push(`  ${fname}: ${tsType(fschema)} = ${defaultExpr(fschema)};`);
    }
    lines.push("");
    lines.push("  encode(): Uint8Array {");
    lines.push(`    return encode(${name}.schema(), this.toValue());`);
    lines.push("  }");
    lines.push("");
    lines.push(`  static decode(buf: Uint8Array): ${name} {`);
    lines.push(`    return ${name}.fromValue(decode(${name}.schema(), buf) as Record<string, unknown>);`);
    lines.push("  }");
    lines.push("");
    lines.push("  static encodedSize(value: Record<string, unknown>): number {");
    lines.push(`    return encode(${name}.schema(), value).byteLength;`);
    lines.push("  }");
    lines.push("");
    lines.push("  toValue(): Record<string, unknown> {");
    lines.push("    return {");
    for (const [fname, fschema] of fields) {
      lines.push(`      ${JSON.stringify(fname)}: ${toValueExpr(fname, fschema)},`);
    }
    lines.push("    };");
    lines.push("  }");
    lines.push("");
    lines.push(`  static fromValue(value: Record<string, unknown>): ${name} {`);
    lines.push(`    const out = new ${name}();`);
    for (const [fname, fschema] of fields) {
      lines.push(`    out.${fname} = ${fromValueExpr(fname, fschema)};`);
    }
    lines.push("    return out;");
    lines.push("  }");
    lines.push("");
    lines.push("  static schema() {");
    lines.push(`    return ${emitSchema(schema)};`);
    lines.push("  }");
    lines.push("}");
    lines.push("");
  }
  return lines.join("\n");
}
