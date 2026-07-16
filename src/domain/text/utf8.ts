export function utf8ByteLength(value: string): number {
  let size = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    size +=
      codePoint <= 0x7f
        ? 1
        : codePoint <= 0x7ff
          ? 2
          : codePoint <= 0xffff
            ? 3
            : 4;
  }
  return size;
}

export function encodeUtf8(value: string): Uint8Array {
  const bytes = new Uint8Array(utf8ByteLength(value));
  let offset = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    if (codePoint <= 0x7f) {
      bytes[offset++] = codePoint;
    } else if (codePoint <= 0x7ff) {
      bytes[offset++] = 0xc0 | (codePoint >> 6);
      bytes[offset++] = 0x80 | (codePoint & 0x3f);
    } else if (codePoint <= 0xffff) {
      bytes[offset++] = 0xe0 | (codePoint >> 12);
      bytes[offset++] = 0x80 | ((codePoint >> 6) & 0x3f);
      bytes[offset++] = 0x80 | (codePoint & 0x3f);
    } else {
      bytes[offset++] = 0xf0 | (codePoint >> 18);
      bytes[offset++] = 0x80 | ((codePoint >> 12) & 0x3f);
      bytes[offset++] = 0x80 | ((codePoint >> 6) & 0x3f);
      bytes[offset++] = 0x80 | (codePoint & 0x3f);
    }
  }
  return bytes;
}

export interface Utf8ChunkResult {
  readonly remainder: Uint8Array;
  readonly value: string;
}

/** Decodes complete UTF-8 code points and retains a split trailing sequence. */
export function decodeUtf8Chunk(bytes: Uint8Array): Utf8ChunkResult {
  let offset = 0;
  let value = "";
  while (offset < bytes.length) {
    const first = bytes[offset]!;
    const length =
      first <= 0x7f
        ? 1
        : first >= 0xc2 && first <= 0xdf
          ? 2
          : first >= 0xe0 && first <= 0xef
            ? 3
            : first >= 0xf0 && first <= 0xf4
              ? 4
              : 0;
    if (length === 0) {
      value += "\ufffd";
      offset += 1;
      continue;
    }
    if (offset + length > bytes.length) {
      return { value, remainder: bytes.slice(offset) };
    }
    let codePoint = length === 1 ? first : first & (0x7f >> length);
    let valid = true;
    for (let index = 1; index < length; index += 1) {
      const continuation = bytes[offset + index]!;
      if ((continuation & 0xc0) !== 0x80) {
        valid = false;
        break;
      }
      codePoint = (codePoint << 6) | (continuation & 0x3f);
    }
    const minimum =
      length === 1 ? 0 : length === 2 ? 0x80 : length === 3 ? 0x800 : 0x10000;
    if (
      !valid ||
      codePoint < minimum ||
      codePoint > 0x10ffff ||
      (codePoint >= 0xd800 && codePoint <= 0xdfff)
    ) {
      value += "\ufffd";
      offset += 1;
      continue;
    }
    value += String.fromCodePoint(codePoint);
    offset += length;
  }
  return { value, remainder: new Uint8Array() };
}
