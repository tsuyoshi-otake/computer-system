import { describe, expect, it } from "vitest";

import { executeSerialMatrixProbe } from "../../src/bedrock/probes/serialMatrixProbe.js";

describe("serial matrix BDS probe", (): void => {
  it("communicates in both directions across three machines and all six faces", (): void => {
    expect(executeSerialMatrixProbe()).toEqual({
      faces: 6,
      links: 36,
      machines: 3,
      transmissions: 72,
    });
  });
});
