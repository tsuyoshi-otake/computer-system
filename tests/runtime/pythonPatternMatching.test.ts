import { describe, expect, it } from "vitest";

import { defaultPythonRuntimeLimits } from "../../src/application/runtime/pythonLimits.js";
import {
  PythonCs486CoreHarness,
  runPythonCs486Core,
} from "./pythonCs486CoreHarness.js";

describe("Computer System Python structural pattern matching", (): void => {
  it("evaluates the subject once, tries cases in order, and retains captures from a false guard", (): void => {
    const machine = runPythonCs486Core(`
calls = 0
def subject():
    global calls
    calls = calls + 1
    return [1, 2]
selected = ""
match subject():
    case [first, second] if first == 0:
        selected = "wrong"
    case [first, second] if first == 1:
        selected = "guarded"
    case _:
        selected = "fallback"
guard_capture = first + second
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("calls")).toBe(1);
    expect(machine.globals.get("selected")).toBe("guarded");
    expect(machine.globals.get("guard_capture")).toBe(3);
  });

  it("matches singleton, literal, dotted value, and OR-AS patterns", (): void => {
    const machine = runPythonCs486Core(`
class Constants:
    answer = 42
none_result = ""
match None:
    case None:
        none_result = "none"
value_result = 0
match 42:
    case 0 | 1:
        value_result = -1
    case Constants.answer as captured:
        value_result = captured
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("none_result")).toBe("none");
    expect(machine.globals.get("value_result")).toBe(42);
  });

  it("matches fixed and starred sequences without publishing partial failed captures", (): void => {
    const machine = runPythonCs486Core(`
match [1, 2, 3, 4]:
    case [head, *middle, tail]:
        sequence_result = head + middle[0] + middle[1] + tail
partial_visible = True
try:
    match [7, 8]:
        case [partial, 9]:
            pass
    leaked = partial
except NameError:
    partial_visible = False
match [5, 1]:
    case [choice, 0] | [choice, 1]:
        or_result = choice
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("sequence_result")).toBe(10);
    expect(machine.globals.get("partial_visible")).toBe(false);
    expect(machine.globals.get("or_result")).toBe(5);
  });

  it("matches mappings, resolves dotted keys, and creates an independent rest dictionary", (): void => {
    const machine = runPythonCs486Core(`
class Keys:
    kind = "kind"
source = {"kind": "point", "x": 3, "y": 4}
match source:
    case {Keys.kind: kind, "x": x, **remaining}:
        mapping_result = kind
        captured_y = remaining["y"]
        remaining["y"] = 9
source_y = source["y"]
rest_y = remaining["y"]
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("mapping_result")).toBe("point");
    expect(machine.globals.get("captured_y")).toBe(4);
    expect(machine.globals.get("source_y")).toBe(4);
    expect(machine.globals.get("rest_y")).toBe(9);
  });

  it("preflights every capture before publishing any name under heap pressure", (): void => {
    const machine = runPythonCs486Core(
      `
failed = False
atomic = False
try:
    match ["${"x".repeat(80)}", "${"y".repeat(80)}"]:
        case [first, second]:
            matched = True
except MemoryError:
    failed = True
try:
    leaked = first
except NameError:
    atomic = True
`,
      {
        limits: {
          ...defaultPythonRuntimeLimits,
          maxMemoryBytes: 600,
          maxStringLength: 1_000,
        },
      },
    );

    expect(
      machine.state.kind,
      JSON.stringify({
        globals: [...machine.globals.keys()],
        memoryUsageBytes: machine.memoryUsageBytes,
        state: machine.state,
      }),
    ).toBe("completed");
    expect(machine.globals.get("failed")).toBe(true);
    expect(machine.globals.get("atomic")).toBe(true);
    expect(machine.globals.has("first")).toBe(false);
    expect(machine.globals.has("second")).toBe(false);
    expect(machine.globals.has("matched")).toBe(false);
  });

  it("matches inherited classes through positional and keyword attributes", (): void => {
    const machine = runPythonCs486Core(`
class Point:
    __match_args__ = ("x", "y")
    def __init__(self, x, y):
        self.x = x
        self.y = y
class ColoredPoint(Point):
    def __init__(self, x, y, color):
        self.x = x
        self.y = y
        self.color = color
point = ColoredPoint(3, 4, "red")
match point:
    case Point(x, y=4):
        class_result = x
    case _:
        class_result = -1
missing_result = "fallback"
match point:
    case ColoredPoint(missing=value):
        missing_result = value
    case _:
        pass
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("class_result")).toBe(3);
    expect(machine.globals.get("missing_result")).toBe("fallback");
  });

  it("raises catchable dynamic mapping and class-pattern contract errors", (): void => {
    const machine = runPythonCs486Core(`
class Keys:
    left = "same"
    right = "same"
duplicate_error = False
try:
    match {"same": 1}:
        case {Keys.left: left, Keys.right: right}:
            pass
except ValueError:
    duplicate_error = True
class Plain:
    pass
positional_error = False
try:
    match Plain():
        case Plain(value):
            pass
except TypeError:
    positional_error = True
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("duplicate_error")).toBe(true);
    expect(machine.globals.get("positional_error")).toBe(true);
  });

  it("keeps match work on bounded CS486 slices and cleans subjects before control transfer", (): void => {
    const machine = new PythonCs486CoreHarness(`
def choose(value):
    match value:
        case [head, *middle, tail]:
            return head + tail
        case _:
            return 0
total = 0
for item in [[1, 2], [3, 4], [5, 6]]:
    match item:
        case [left, right]:
            total = total + choose(item)
`);
    let slices = 0;
    while (
      slices < 10_000 &&
      (machine.state.kind === "ready" || machine.hasPendingCpuCycles)
    ) {
      machine.runCpuSlice(64, 4);
      slices += 1;
    }

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("total")).toBe(21);
    expect(slices).toBeGreaterThan(1);
    expect(slices).toBeLessThan(10_000);
  });
});
