import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  cs486WasmVariantNames,
  resolveCs486WasmArtifactPath,
} from "../../tools/cs486-wasm-batch-executor-loader.mjs";
import {
  parseEquivalenceArguments,
  runCs486WasmEquivalence,
} from "../../tools/verify-cs486-wasm-equivalence.mjs";

// The wasm artifact is built with `npm run build:cs486-wasm`;
// `npm run validate` must stay green without cargo, so the differential suite
// skips when it is absent instead of failing. The standalone CLI remains the
// loud full-evidence path.
const artifactsPresent = cs486WasmVariantNames.every((variant) =>
  existsSync(resolveCs486WasmArtifactPath(variant)),
);

describe("CS486 wasm equivalence CLI argument contract", () => {
  it("parses bounded seed counts and scoped lists", () => {
    expect(
      parseEquivalenceArguments([
        "--seeds",
        "4",
        "--cpu",
        "cs386sx,cs486dx2",
        "--mode",
        "cpu-slice",
        "--instrumentation",
        "disabled",
        "--engines",
        "rust",
      ]),
    ).toEqual({
      cpuModels: ["cs386sx", "cs486dx2"],
      engines: ["rust"],
      executionModes: ["cpu-slice"],
      instrumentationModes: ["disabled"],
      seedCount: 4,
    });
  });

  it("rejects unknown arguments and out-of-range or invalid values", () => {
    expect(() => parseEquivalenceArguments(["--unknown"])).toThrow(
      /Unknown equivalence argument/u,
    );
    expect(() => parseEquivalenceArguments(["--seeds", "abc"])).toThrow(
      /seeds must be an integer/u,
    );
    expect(() => parseEquivalenceArguments(["--seeds", "513"])).toThrow(
      /seeds must be between 0 and 512/u,
    );
    expect(() => parseEquivalenceArguments(["--cpu", "pentium"])).toThrow(
      /cpu must list values from cs386sx, cs486dx, cs486dx2/u,
    );
    expect(() => parseEquivalenceArguments(["--engines"])).toThrow(
      /engines must list values from rust/u,
    );
    expect(() => parseEquivalenceArguments(["--engines", "as"])).toThrow(
      /engines must list values from rust/u,
    );
  });
});

describe.skipIf(!artifactsPresent)(
  "CS486 wasm differential equivalence (requires built wasm artifacts)",
  () => {
    it(
      "reports zero divergences for every variant on a bounded fuzz sweep",
      { timeout: 300_000 },
      async () => {
        const { divergenceCount, reports } = await runCs486WasmEquivalence({
          cpuModels: ["cs386sx", "cs486dx", "cs486dx2"],
          engines: [...cs486WasmVariantNames],
          executionModes: ["cpu-slice", "instruction-slice"],
          instrumentationModes: ["enabled", "disabled"],
          seedCount: 4,
        });
        expect(reports).toHaveLength(cs486WasmVariantNames.length);
        for (const report of reports) {
          // Every configuration ran: (11 forced + 4 seeds) x 3 CPUs x 2
          // modes x 2 instrumentation settings, with real field comparisons.
          expect(report.configurations).toBe(15 * 3 * 2 * 2);
          expect(report.comparisons).toBeGreaterThan(report.configurations);
          expect(report.divergences).toEqual([]);
          expect(report.programs).toContain("forced-int-min-div-neg-one");
          expect(report.programs).toContain("fuzz-seed-4");
        }
        expect(divergenceCount).toBe(0);
      },
    );
  },
);
