import { FloatBits } from "./binary.ts";
import { KilnError } from "./error.ts";
import { typeHash } from "./hashing.ts";
import { parseTypeText, schemaFromCase, schemaFromJson } from "./schema.ts";
import { CAP, HEADER, decodeTensors, encodeTensors } from "./tensor.ts";
import { Writer, decode, decodeFramed, encode, encodeFramed, minSize } from "./frozen.ts";

export const VERSION = "0.1.0";

export {
  CAP,
  HEADER,
  FloatBits,
  KilnError,
  Writer,
  decode,
  decodeFramed,
  decodeTensors,
  encode,
  encodeFramed,
  encodeTensors,
  minSize,
  parseTypeText,
  schemaFromCase,
  schemaFromJson,
  typeHash,
};

export type { Field, Schema } from "./schema.ts";
export type { TensorDirectory, TensorIn, TensorOut } from "./tensor.ts";
export type { CodecOptions } from "./frozen.ts";
