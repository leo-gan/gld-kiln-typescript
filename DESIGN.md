# Kiln for TypeScript

Kiln is a positional little-endian codec. The caller passes the schema. `Writer` owns a buffer and reuses it. `decode` is checked. A tensor payload is a `Uint8Array` view of the input.

The normative text is [Kiln wire v2](https://leo-gan.github.io/gld-kiln/spec/). This repo does not copy that text into a Spec page.

| Topic | Choice |
| --- | --- |
| Wire | Frozen layout and the version-2 tensor directory |
| API | `encode` / `decode`, `Writer`, `encodeTensors` / `decodeTensors`, `schemaFromJson`, `gld-kilngen-typescript` |
| Lengths | `u32` byte counts. Dict keys are sorted. Default cap 16777216 |
| Errors | `KilnError.code` is FRAME, LIMIT, EOF, TYPE, UTF8, TRAILING, or SCHEMA |
| Package | `gld-kiln`, import `gld-kiln`, Node 24, MIT |
