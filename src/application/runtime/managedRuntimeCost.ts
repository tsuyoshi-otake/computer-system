/** Deterministic instruction-equivalent costs shared by managed guest runtimes. */

export type ManagedNumericRepresentation = "perl_scalar" | "python_integer";

export const managedRuntimeCost = Object.freeze({
  collectionElement: 8,
  dispatch: 16,
  iteratorAcquire: 12,
  iteratorStep: 10,
  load: 8,
  store: 12,
  typeCheck: 6,
});

const maximumWorkCycles = 1_000_000_000;

/** Python 3.14 integers use a 30-bit limb model in the guest runtime. */
export function managedPythonIntegerLimbCount(value: unknown): number {
  if (typeof value !== "bigint") return 1;
  const magnitude = value < 0n ? -value : value;
  if (magnitude === 0n) return 1;
  return Math.max(1, Math.ceil(magnitude.toString(2).length / 30));
}

export function managedLoadWorkCycles(
  value: unknown,
  representation: ManagedNumericRepresentation,
): number {
  return (
    managedRuntimeCost.load + managedValueTraversalCycles(value, representation)
  );
}

export function managedStoreWorkCycles(
  value: unknown,
  representation: ManagedNumericRepresentation,
): number {
  return (
    managedRuntimeCost.store +
    managedValueTraversalCycles(value, representation)
  );
}

export function managedCollectionWorkCycles(elementCount: number): number {
  return boundedCycles(
    Math.max(0, elementCount) * managedRuntimeCost.collectionElement,
  );
}

export function managedStringWorkCycles(characterCount: number): number {
  return Math.ceil(Math.max(0, characterCount) / 4);
}

export function managedCompareWorkCycles(
  left: unknown,
  right: unknown,
  representation: ManagedNumericRepresentation,
): number {
  if (typeof left === "string" || typeof right === "string") {
    return (
      managedRuntimeCost.typeCheck +
      managedStringWorkCycles(
        Math.max(String(left).length, String(right).length),
      )
    );
  }
  if (representation === "python_integer") {
    return boundedCycles(
      managedRuntimeCost.typeCheck +
        4 *
          Math.max(
            managedPythonIntegerLimbCount(left),
            managedPythonIntegerLimbCount(right),
          ),
    );
  }
  return managedRuntimeCost.typeCheck + 4;
}

export function managedBinaryWorkCycles(
  operator: string,
  left: unknown,
  right: unknown,
  result: unknown,
  representation: ManagedNumericRepresentation,
): number {
  if (
    operator === "." ||
    operator === "+string" ||
    (operator === "+" && typeof result === "string")
  ) {
    return (
      managedRuntimeCost.typeCheck +
      managedStringWorkCycles(String(result).length)
    );
  }
  if (operator === "x") {
    return boundedCycles(
      managedRuntimeCost.typeCheck +
        13 +
        managedStringWorkCycles(String(result).length),
    );
  }
  if (isComparisonOperator(operator)) {
    return managedCompareWorkCycles(left, right, representation);
  }

  const rawCycles = rawArithmeticCycles(operator, left, right, representation);
  const resultCycles =
    representation === "python_integer" && typeof result === "bigint"
      ? 8 + managedPythonIntegerLimbCount(result) * 4
      : 0;
  return boundedCycles(managedRuntimeCost.typeCheck + rawCycles + resultCycles);
}

function rawArithmeticCycles(
  operator: string,
  left: unknown,
  right: unknown,
  representation: ManagedNumericRepresentation,
): number {
  const leftLimbs =
    representation === "python_integer"
      ? managedPythonIntegerLimbCount(left)
      : 1;
  const rightLimbs =
    representation === "python_integer"
      ? managedPythonIntegerLimbCount(right)
      : 1;
  switch (operator) {
    case "*":
      return boundedCycles(13 * leftLimbs * rightLimbs);
    case "/":
    case "//":
    case "%":
      return boundedCycles(40 * leftLimbs * rightLimbs);
    case "**":
      return boundedCycles(
        80 * Math.max(leftLimbs, managedPythonIntegerLimbCount(right)),
      );
    default:
      return boundedCycles(4 * Math.max(leftLimbs, rightLimbs));
  }
}

function managedValueTraversalCycles(
  value: unknown,
  representation: ManagedNumericRepresentation,
): number {
  return representation === "python_integer" && typeof value === "bigint"
    ? managedPythonIntegerLimbCount(value) * 2
    : 2;
}

function isComparisonOperator(operator: string): boolean {
  return [
    "==",
    "!=",
    "<",
    ">",
    "<=",
    ">=",
    "eq",
    "ne",
    "lt",
    "gt",
    "le",
    "ge",
    "cmp",
  ].includes(operator);
}

function boundedCycles(cycles: number): number {
  return Math.min(maximumWorkCycles, Math.max(0, Math.ceil(cycles)));
}
