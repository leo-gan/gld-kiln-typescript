# gld-kiln-typescript

A from-scratch Kiln codec for TypeScript. The runtime and the code generator are TypeScript. They do not wrap, link, or vendor another language's Kiln library.

`testdata/reference/kiln_ref.py` is a test oracle for Frozen values. It is not used at run time.

This repository is a standalone library.

Documentation: [Why Kiln](https://leo-gan.github.io/gld-kiln-typescript/why-kiln/),
[Instructions](https://leo-gan.github.io/gld-kiln-typescript/instructions/),
[Examples](https://leo-gan.github.io/gld-kiln-typescript/examples/),
[Techniques](https://leo-gan.github.io/gld-kiln-typescript/techniques/),
[Test data](https://leo-gan.github.io/gld-kiln-typescript/test-data/).

## Install

```bash
npm install gld-kiln
```

The import name is `gld-kiln`. The generator command is `gld-kilngen-typescript`.

```typescript
import { Writer, decode } from "gld-kiln";

const point = ["struct", [["x", ["i32"]], ["y", ["i32"]]]] as const;
const writer = new Writer();
const raw = writer.encode(point, { x: 9, y: -4 });
console.log(decode(point, raw));
```

## License

MIT. Copyright (c) 2026 Leonid Ganeline.
