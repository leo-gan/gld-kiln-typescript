/** Kiln error codes. The names match the wire specification. */

export class KilnError extends Error {
  code: string;
  offset: number;

  constructor(code: string, offset = 0) {
    super(code);
    this.name = "KilnError";
    this.code = code;
    this.offset = offset;
  }
}
