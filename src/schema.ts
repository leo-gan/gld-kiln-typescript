/** JSON Schema subset used by the generator. See the Kiln wire spec. */

import { KilnError } from "./error.ts";

export type Schema = readonly [string, ...unknown[]];
export type Field = readonly [string, Schema];

const INT: Record<string, string> = {
  int8: "i8",
  int16: "i16",
  int32: "i32",
  int64: "i64",
  uint8: "u8",
  uint16: "u16",
  uint32: "u32",
  uint64: "u64",
};

export function parseTypeText(text: string): Schema {
  const trimmed = text.trim();
  if (trimmed.startsWith("struct{") && trimmed.endsWith("}")) {
    const body = trimmed.slice("struct{".length, -1);
    const fields: Field[] = [];
    if (body) {
      for (const part of body.split(",")) {
        if (!part) {
          continue;
        }
        const splitAt = part.indexOf(":");
        const name = part.slice(0, splitAt);
        const typ = part.slice(splitAt + 1);
        fields.push([name, parseTypeText(typ)]);
      }
    }
    return ["struct", fields];
  }
  if (trimmed.startsWith("list<") && trimmed.endsWith(">")) {
    return ["list", parseTypeText(trimmed.slice(5, -1))];
  }
  if (trimmed.startsWith("opt<") && trimmed.endsWith(">")) {
    return ["opt", parseTypeText(trimmed.slice(4, -1))];
  }
  return [trimmed];
}

export function schemaFromCase(schema: unknown): Schema {
  if (schema === "tensor-v2") {
    return ["tensors"];
  }
  if (schema === "frame") {
    return ["struct", [["id", ["i64"]], ["batch", ["tensors"]]]];
  }
  if (schema && typeof schema === "object" && (schema as { type?: string }).type === "list") {
    return ["list", parseTypeText(String((schema as { element: string }).element))];
  }
  if (schema && typeof schema === "object" && (schema as { type?: string }).type === "struct") {
    const fields: Field[] = [];
    for (const item of (schema as { fields: string[] }).fields) {
      const splitAt = item.indexOf(":");
      const name = item.slice(0, splitAt);
      const typ = item.slice(splitAt + 1);
      fields.push([name, parseTypeText(typ)]);
    }
    return ["struct", fields];
  }
  throw new KilnError("SCHEMA");
}

type JsonNode = Record<string, unknown>;

export function schemaFromJson(text: string): readonly [string, Schema] {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch (err) {
    throw new KilnError("SCHEMA");
  }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    throw new KilnError("SCHEMA");
  }
  const rootDoc = doc as JsonNode;
  const defs = (rootDoc.$defs as Record<string, JsonNode> | undefined) ?? {};
  const cache = new Map<string, Schema>();
  const building = new Set<string>();

  function convert(node: JsonNode, label: string): Schema {
    if ("$ref" in node) {
      const ref = node.$ref;
      const prefix = "#/$defs/";
      if (typeof ref !== "string" || !ref.startsWith(prefix)) {
        throw new KilnError("SCHEMA");
      }
      return resolve(ref.slice(prefix.length));
    }
    const kind = node.type;
    if (kind === "boolean") {
      return ["bool"];
    }
    if (kind === "string") {
      return node.format === "binary" ? ["bytes"] : ["str"];
    }
    if (kind === "integer") {
      const format = typeof node.format === "string" ? node.format : "";
      return [INT[format] ?? "i64"];
    }
    if (kind === "number") {
      return node.format === "float" ? ["f32"] : ["f64"];
    }
    if (kind === "array") {
      const items = node.items;
      if (!items || typeof items !== "object" || Array.isArray(items)) {
        throw new KilnError("SCHEMA");
      }
      return ["list", convert(items as JsonNode, label + "Item")];
    }
    if (kind === "object") {
      const props = (node.properties as Record<string, JsonNode> | undefined) ?? {};
      const extra = node.additionalProperties;
      if (extra && typeof extra === "object" && !Array.isArray(extra) && Object.keys(props).length === 0) {
        return ["dict", convert(extra as JsonNode, label + "Value")];
      }
      return objectSchema(node, label);
    }
    throw new KilnError("SCHEMA");
  }

  function resolve(name: string): Schema {
    const cached = cache.get(name);
    if (cached) {
      return cached;
    }
    if (building.has(name) || !(name in defs)) {
      throw new KilnError("SCHEMA");
    }
    building.add(name);
    const built = convert(defs[name], name);
    building.delete(name);
    cache.set(name, built);
    return built;
  }

  function objectSchema(node: JsonNode, label: string): Schema {
    const props = (node.properties as Record<string, JsonNode> | undefined) ?? {};
    const required = node.required;
    const fields: Field[] = [];
    for (const [fname, body] of Object.entries(props)) {
      let field = convert(body, label + "_" + fname);
      if (Array.isArray(required) && !required.includes(fname)) {
        field = ["opt", field];
      }
      fields.push([fname, field]);
    }
    return ["struct", fields, label];
  }

  const title = typeof rootDoc.title === "string" && rootDoc.title ? rootDoc.title : "Root";
  return [title, convert(rootDoc, title)];
}
