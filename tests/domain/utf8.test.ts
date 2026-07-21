import { describe, expect, it } from "vitest";

import {
  decodeUtf8,
  encodeUtf8,
  utf8ByteLength,
} from "../../src/domain/text/utf8.js";

describe("deterministic UTF-8 primitives", () => {
  it("round-trips ASCII, multibyte, supplementary, replacement, and empty values", () => {
    for (const value of ["", "ASCII", "¢€😀", "replacement: �"]) {
      const encoded = encodeUtf8(value);
      expect(encoded).toHaveLength(utf8ByteLength(value));
      expect(decodeUtf8(encoded)).toBe(value);
    }
  });

  it("matches TextEncoder replacement semantics for lone surrogates", () => {
    expect([...encodeUtf8("\ud800A\udc00")]).toEqual([
      0xef, 0xbf, 0xbd, 0x41, 0xef, 0xbf, 0xbd,
    ]);
    expect(utf8ByteLength("\ud800A\udc00")).toBe(7);
  });

  it.each([
    ["invalid lead", [0x80]],
    ["invalid continuation", [0xc2, 0x20]],
    ["overlong", [0xc0, 0x80]],
    ["surrogate", [0xed, 0xa0, 0x80]],
    ["out of range", [0xf4, 0x90, 0x80, 0x80]],
    ["truncated", [0xe2, 0x82]],
  ])("rejects %s input", (_label, bytes) => {
    expect(() => decodeUtf8(Uint8Array.from(bytes))).toThrow(
      "invalid UTF-8 byte sequence",
    );
  });
});
