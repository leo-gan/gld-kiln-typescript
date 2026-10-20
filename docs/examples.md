# Examples

`Point` has two `i32` fields. Kiln writes them in that order. Eight little-endian bytes, and no names.

```typescript
import { Writer, decode } from "gld-kiln";

const point = ["struct", [["x", ["i32"]], ["y", ["i32"]]]] as const;
const writer = new Writer(64);
const raw = writer.encode(point, { x: 9, y: -4 });
console.log(decode(point, raw), raw.byteLength);
```

The program prints `{ x: 9, y: -4 } 8`.

A tensor directory keeps the numeric payload as the array. The view's `data` field is a slice of the input buffer.

```typescript
import { decodeTensors, encodeTensors } from "gld-kiln";

const block = encodeTensors([
  {
    name: null,
    dtype: "f32",
    shape: [2],
    data: new Uint8Array([0x00, 0x00, 0x80, 0x3f, 0x00, 0x00, 0x00, 0xc0]),
  },
]);
const [directory, length] = decodeTensors(block);
const payload = directory.tensors[0].data;
console.log(length, Buffer.from(payload).toString("hex"));
```
