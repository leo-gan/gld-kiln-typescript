# Instructions

Node 24 or newer.

```bash
npm install gld-kiln
```

From a git checkout:

```bash
node --test test/*.test.ts
node src/cli.ts testdata/schema/point.json -o point_gen.ts
```

The import name is `gld-kiln`. `encode` and `decode` take a schema tuple and a value. `Writer` reuses one buffer across calls. `schemaFromJson` reads the JSON Schema subset: booleans, integers with an optional `format`, numbers, strings, binary strings, arrays, objects, `$ref` of the form `#/$defs/Name`, and `additionalProperties` as a dict. A property omitted from `required` is optional. `gld-kilngen-typescript` writes one TypeScript module of classes. A `tensors` field is not produced from that JSON subset. Build a tensor directory with `encodeTensors` and read it with `decodeTensors`.
