import { describe, expect, it } from "vitest";

import { runPythonCs486 } from "./pythonCs486Harness.js";

describe("Computer System Python call binding", (): void => {
  it("binds positional-only, keyword-only, variadic, and default parameters", (): void => {
    const machine = runPythonCs486(`
def collect(a, b=2, /, c=3, *values, required, optional=5, **named):
    return [a, b, c, values[0], required, optional, named["bonus"], named["a"]]
mapping = {"bonus": 7, "a": 8}
result = collect(1, 4, 6, *[9], required=10, **mapping)
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("result")).toEqual({
      kind: "list",
      values: [1, 4, 6, 9, 10, 5, 7, 8],
    });
  });

  it("evaluates defaults once from left to right at definition time", (): void => {
    const machine = runPythonCs486(`
order = 0
def mark(value):
    global order
    order = order * 10 + value
    return value
def sample(first=mark(1), *, second=mark(2)):
    return first * 10 + second
definition_order = order
first_result = sample()
second_result = sample()
final_order = order
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("definition_order")).toBe(12);
    expect(machine.globals.get("first_result")).toBe(12);
    expect(machine.globals.get("second_result")).toBe(12);
    expect(machine.globals.get("final_order")).toBe(12);
  });

  it("evaluates call items left to right while merging unpacked values", (): void => {
    const machine = runPythonCs486(`
order = 0
def mark(value):
    global order
    order = order * 10 + value
    return value
def target(*values, **named):
    return [values[0], values[1], named["second"], named["last"]]
result = target(mark(1), second=mark(2), *[mark(3)], **{"last": mark(4)})
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("order")).toBe(1234);
    expect(machine.globals.get("result")).toEqual({
      kind: "list",
      values: [1, 3, 2, 4],
    });
  });

  it("captures variadic parameter cells in retained closures", (): void => {
    const machine = runPythonCs486(`
def outer(prefix, *values, **named):
    def inner():
        return prefix + values[0] + named["tail"]
    return inner
result = outer(10, 20, tail=12)()
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("result")).toBe(42);
  });

  it.each([
    [
      "missing keyword-only argument",
      "def sample(*, required):\n    return required\nsample()\n",
    ],
    [
      "positional-only argument by keyword",
      "def sample(value, /):\n    return value\nsample(value=1)\n",
    ],
    [
      "duplicate keyword after mapping unpack",
      'def sample(value):\n    return value\nsample(value=1, **{"value": 2})\n',
    ],
    [
      "non-string mapping key",
      "def sample(**named):\n    return named\nsample(**{1: 2})\n",
    ],
  ])("reports TypeError for %s", (_name, source): void => {
    const machine = runPythonCs486(source);

    expect(machine.state.kind).toBe("crashed");
    if (machine.state.kind === "crashed") {
      expect(machine.state.error.typeName).toBe("TypeError");
    }
  });

  it("short-circuits chained comparisons and evaluates the middle once", (): void => {
    const machine = runPythonCs486(`
calls = 0
def mark(value):
    global calls
    calls = calls + 1
    return value
ascending = mark(1) < mark(2) < mark(3)
ascending_calls = calls
calls = 0
descending = mark(3) < mark(2) < missing_name
descending_calls = calls
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("ascending")).toBe(true);
    expect(machine.globals.get("ascending_calls")).toBe(3);
    expect(machine.globals.get("descending")).toBe(false);
    expect(machine.globals.get("descending_calls")).toBe(2);
  });

  it("accepts the expanded argument ceiling and rejects capacity plus one", (): void => {
    const exact = runPythonCs486(`
def count(*values):
    return len(values)
result = count(*range(2048), *range(2048))
`);
    const excessive = runPythonCs486(`
def count(*values):
    return len(values)
result = count(*range(2048), *range(2048), 1)
`);

    expect(exact.state.kind).toBe("completed");
    expect(exact.globals.get("result")).toBe(4_096);
    expect(excessive.state.kind).toBe("crashed");
    if (excessive.state.kind === "crashed") {
      expect(excessive.state.error.typeName).toBe("ResourceLimitError");
      expect(excessive.state.error.message).toMatch(/expanded arguments/u);
    }
  });
});
