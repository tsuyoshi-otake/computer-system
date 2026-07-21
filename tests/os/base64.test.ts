import { describe, expect, it } from "vitest";

import { base64Decode, base64Encode } from "../../src/application/os/base64.js";

describe("base64Encode/base64Decode", (): void => {
  it("encodes known vectors", (): void => {
    expect(base64Encode("")).toBe("");
    expect(base64Encode("hello")).toBe("aGVsbG8=");
    expect(base64Encode("any carnal pleasure.")).toBe(
      "YW55IGNhcm5hbCBwbGVhc3VyZS4=",
    );
  });

  it("encodes multi-byte UTF-8 input", (): void => {
    expect(base64Encode("こんにちは")).toBe("44GT44KT44Gr44Gh44Gv");
  });

  it("round-trips through encode then decode", (): void => {
    const samples = ["", "a", "ab", "abc", "abcd", "Computer System!"];
    for (const sample of samples) {
      expect(base64Decode(base64Encode(sample))).toBe(sample);
    }
    expect(base64Decode(base64Encode("こんにちは"))).toBe("こんにちは");
  });

  it("decodes known vectors", (): void => {
    expect(base64Decode("aGVsbG8=")).toBe("hello");
    expect(base64Decode("YW55IGNhcm5hbCBwbGVhc3VyZS4=")).toBe(
      "any carnal pleasure.",
    );
  });

  it("rejects malformed base64 input explicitly", (): void => {
    expect(() => base64Decode("not valid base64!!")).toThrow(
      "invalid base64 input",
    );
    expect(() => base64Decode("abc")).toThrow("invalid base64 input");
  });

  it("rejects a decoded byte sequence that is not valid UTF-8", (): void => {
    expect(() => base64Decode("/w==")).toThrow(
      "invalid utf-8 sequence in base64 input",
    );
  });
});
