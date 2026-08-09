import { describe, expect, it } from "vitest";

import {
  managedBinaryWorkCycles,
  managedCollectionWorkCycles,
  managedCompareWorkCycles,
  managedPythonIntegerLimbCount,
  managedRuntimeCost,
  managedStringWorkCycles,
} from "../../src/application/runtime/managedRuntimeCost.js";

describe("shared managed-runtime cost model", (): void => {
  it("orders scalar 486 arithmetic without language-specific benchmark constants", (): void => {
    const cost = (operator: string): number =>
      managedBinaryWorkCycles(operator, 21, 3, 7, "perl_scalar");

    expect(cost("+")).toBeLessThan(cost("*"));
    expect(cost("*")).toBeLessThan(cost("/"));
    expect(cost("/")).toBeLessThan(cost("**"));
  });

  it("charges Python arbitrary-precision work by 30-bit limb count", (): void => {
    const small = 1n << 29n;
    const large = 1n << 120n;

    expect(managedPythonIntegerLimbCount(small)).toBe(1);
    expect(managedPythonIntegerLimbCount(large)).toBe(5);
    expect(
      managedBinaryWorkCycles(
        "*",
        large,
        large,
        large * large,
        "python_integer",
      ),
    ).toBeGreaterThan(
      managedBinaryWorkCycles(
        "*",
        small,
        small,
        small * small,
        "python_integer",
      ),
    );
    expect(
      managedCompareWorkCycles(large, large - 1n, "python_integer"),
    ).toBeGreaterThan(
      managedCompareWorkCycles(small, small - 1n, "python_integer"),
    );
  });

  it("scales collection and string work with bounded input size", (): void => {
    expect(managedCollectionWorkCycles(10)).toBe(
      10 * managedRuntimeCost.collectionElement,
    );
    expect(managedCollectionWorkCycles(10)).toBeGreaterThan(
      managedCollectionWorkCycles(1),
    );
    expect(managedStringWorkCycles(100)).toBeGreaterThan(
      managedStringWorkCycles(4),
    );
  });
});
