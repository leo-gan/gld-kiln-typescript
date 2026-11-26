import { FloatBits } from "./binary.ts";
import { KilnError } from "./error.ts";
import { typeHash } from "./hashing.ts";
import { parseTypeText, schemaFromCase, schemaFromJson } from "./schema.ts";
import { CAP, HEADER, decodeTensors, encodeTensors } from "./tensor.ts";
import { Codec, Writer, compile, decode, decodeFramed, encode, encodeFramed, minSize } from "./frozen.ts";

export const VERSION = "0.2.1";

export {
  CAP,
  HEADER,
  Codec,
  FloatBits,
  KilnError,
  Writer,
  compile,
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
