import { describe, expect, it } from "vitest";

import { md5Hex } from "../../src/application/os/md5Hash.js";

describe("md5Hex", (): void => {
  it("matches known MD5 test vectors", (): void => {
    expect(md5Hex("")).toBe("d41d8cd98f00b204e9800998ecf8427e");
    expect(md5Hex("abc")).toBe("900150983cd24fb0d6963f7d28e17f72");
    expect(md5Hex("The quick brown fox jumps over the lazy dog")).toBe(
      "9e107d9d372bb6826bd81d3542a419d6",
    );
  });

  it("hashes input spanning multiple 64-byte blocks", (): void => {
    const long = "a".repeat(200);
    expect(md5Hex(long)).toBe("887f30b43b2867f4a9accceee7d16e6c");
  });

  it("is deterministic and sensitive to a single changed character", (): void => {
    expect(md5Hex("hello")).toBe(md5Hex("hello"));
    expect(md5Hex("hello")).not.toBe(md5Hex("hellp"));
  });

  it("hashes multi-byte UTF-8 input", (): void => {
    expect(md5Hex("こんにちは")).toBe("c0e89a293bd36c7a768e4e9d2c5475a8");
  });
});
