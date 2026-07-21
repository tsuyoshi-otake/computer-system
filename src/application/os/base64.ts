import { utf8Bytes } from "./passwordHash.js";

const alphabet =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function base64Encode(value: string): string {
  const bytes = utf8Bytes(value);
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const byte0 = bytes[index]!;
    const byte1 = bytes[index + 1];
    const byte2 = bytes[index + 2];
    output += alphabet[byte0 >> 2]!;
    output += alphabet[((byte0 & 0b11) << 4) | ((byte1 ?? 0) >> 4)]!;
    output +=
      byte1 === undefined
        ? "="
        : alphabet[((byte1 & 0b1111) << 2) | ((byte2 ?? 0) >> 6)]!;
    output += byte2 === undefined ? "=" : alphabet[byte2 & 0b111111]!;
  }
  return output;
}

export function base64Decode(value: string): string {
  const cleaned = value.replaceAll(/\s+/gu, "");
  if (cleaned.length === 0) return "";
  if (cleaned.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(cleaned)) {
    throw new Error("invalid base64 input");
  }
  const withoutPadding = cleaned.replace(/=+$/u, "");
  const bytes: number[] = [];
  for (let index = 0; index < withoutPadding.length; index += 4) {
    const values = [...withoutPadding.slice(index, index + 4)].map(
      (character) => alphabet.indexOf(character),
    );
    bytes.push((values[0]! << 2) | (values[1]! >> 4));
    if (values.length > 2) {
      bytes.push(((values[1]! & 0b1111) << 4) | (values[2]! >> 2));
    }
    if (values.length > 3) {
      bytes.push(((values[2]! & 0b11) << 6) | values[3]!);
    }
  }
  return decodeUtf8(new Uint8Array(bytes));
}

function decodeUtf8(bytes: Uint8Array): string {
  let result = "";
  let index = 0;
  while (index < bytes.length) {
    const byte0 = bytes[index]!;
    if (byte0 <= 0x7f) {
      result += String.fromCodePoint(byte0);
      index += 1;
      continue;
    }
    const length = leadingByteLength(byte0);
    if (length === 0) {
      throw new Error("invalid utf-8 sequence in base64 input");
    }
    const continuationBytes = bytes.slice(index + 1, index + length);
    if (
      continuationBytes.length !== length - 1 ||
      [...continuationBytes].some((byte) => (byte & 0xc0) !== 0x80)
    ) {
      throw new Error("invalid utf-8 sequence in base64 input");
    }
    const codePoint =
      length === 2
        ? ((byte0 & 0x1f) << 6) | (continuationBytes[0]! & 0x3f)
        : length === 3
          ? ((byte0 & 0x0f) << 12) |
            ((continuationBytes[0]! & 0x3f) << 6) |
            (continuationBytes[1]! & 0x3f)
          : ((byte0 & 0x07) << 18) |
            ((continuationBytes[0]! & 0x3f) << 12) |
            ((continuationBytes[1]! & 0x3f) << 6) |
            (continuationBytes[2]! & 0x3f);
    result += String.fromCodePoint(codePoint);
    index += length;
  }
  return result;
}

function leadingByteLength(byte0: number): number {
  if ((byte0 & 0xe0) === 0xc0) return 2;
  if ((byte0 & 0xf0) === 0xe0) return 3;
  if ((byte0 & 0xf8) === 0xf0) return 4;
  return 0;
}
