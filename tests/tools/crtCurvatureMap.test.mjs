import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  buildCrtCurvatureMapPng,
  crtCurvatureMapPath,
  crtCurvatureMapSize,
} from "../../tools/generate-crt-curvature-map.mjs";

describe("CRT curvature displacement map", () => {
  it("builds one bounded deterministic RGBA PNG", () => {
    const first = buildCrtCurvatureMapPng();
    const second = buildCrtCurvatureMapPng();
    expect(first.equals(second)).toBe(true);
    expect(first.subarray(0, 8)).toEqual(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    );
    expect(first.readUInt32BE(16)).toBe(crtCurvatureMapSize);
    expect(first.readUInt32BE(20)).toBe(crtCurvatureMapSize);
    expect(first[24]).toBe(8);
    expect(first[25]).toBe(6);
    expect(first.byteLength).toBeLessThan(64 * 1024);
  });

  it("keeps the checked-in map synchronized with the shared coordinate model", async () => {
    expect(await readFile(crtCurvatureMapPath)).toEqual(
      buildCrtCurvatureMapPng(),
    );
  });

  it("rejects unbounded generator sizes", () => {
    expect(() => buildCrtCurvatureMapPng(1)).toThrow(/from 2 through 256/u);
    expect(() => buildCrtCurvatureMapPng(257)).toThrow(/from 2 through 256/u);
  });
});
