import { describe, expect, it } from "vitest";

import type { RuntimeNamespace } from "../../src/domain/runtime/value.js";
import { defaultPythonRuntimeLimits } from "../../src/application/runtime/pythonLimits.js";
import {
  PythonCs486CoreHarness,
  runPythonCs486Core,
} from "./pythonCs486CoreHarness.js";

function namespace(value: unknown): RuntimeNamespace {
  expect(value).toMatchObject({ kind: "namespace" });
  return value as RuntimeNamespace;
}

describe("Computer System Python 3.14 template strings", (): void => {
  it("shares ordered replacement, conversion, debug, and format semantics with f-strings", (): void => {
    const machine = runPythonCs486Core(`
events = ""
def take(value):
    global events
    events = events + str(value)
    return value
formatted = f"{take(3)!r:>{take(5)}}:{take(4)=}:{3.14159:.2f}:{42:04d}"
`);

    expect(machine.state).toMatchObject({ kind: "completed" });
    expect(machine.globals.get("events")).toBe("354");
    expect(machine.globals.get("formatted")).toBe("    3:take(4)=4:3.14:0042");
  });

  it("evaluates interpolations once and retains authored metadata", (): void => {
    const machine = runPythonCs486Core(`
events = ""
precision = 2
def take(value):
    global events
    events = events + str(value)
    return value
template = t"left={take(3)!s:.{precision}f}; debug={ precision = }"
first = template.interpolations[0]
second = template.interpolations[1]
`);

    expect(machine.state).toMatchObject({ kind: "completed" });
    expect(machine.globals.get("events")).toBe("3");
    const template = namespace(machine.globals.get("template"));
    expect(template.name).toBe("Template");
    expect(template.values.get("strings")).toMatchObject({
      kind: "tuple",
      values: ["left=", "; debug= precision = ", ""],
    });
    const first = namespace(machine.globals.get("first"));
    expect(first.values.get("value")).toBe(3);
    expect(first.values.get("expression")).toBe("take(3)");
    expect(first.values.get("conversion")).toBe("s");
    expect(first.values.get("format_spec")).toBe(".2f");
    const second = namespace(machine.globals.get("second"));
    expect(second.values.get("value")).toBe(2);
    expect(second.values.get("conversion")).toBe("r");
  });

  it("keeps Template and Interpolation reflection read-only", (): void => {
    const machine = runPythonCs486Core(`
template = t"{1}"
interpolation = template.interpolations[0]
template_read_only = False
interpolation_read_only = False
try:
    template.strings = ()
except AttributeError:
    template_read_only = True
try:
    interpolation.value = 2
except AttributeError:
    interpolation_read_only = True
`);

    expect(machine.state).toMatchObject({ kind: "completed" });
    expect(machine.globals.get("template_read_only")).toBe(true);
    expect(machine.globals.get("interpolation_read_only")).toBe(true);
  });

  it("provides constructors, conversion, iteration, and Template concatenation", (): void => {
    const machine = runPythonCs486Core(`
from string.templatelib import Interpolation, Template, convert
import string.templatelib as templatelib

first = Interpolation("Camembert", "cheese", conversion="s")
second = Interpolation(".", "punctuation")
manual = Template("We have ", first, second)
parts = list(manual)
combined = t"left " + t"{first.value} right"
string_value = convert(3, "s")
repr_value = convert("text", "r")
ascii_value = convert("é", "a")
bad_concat = False
template_check = isinstance(manual, Template)
interpolation_check = isinstance(first, templatelib.Interpolation)
iterated = ""
for part in manual:
    if isinstance(part, Interpolation):
        iterated = iterated + part.expression
    else:
        iterated = iterated + part
try:
    combined + "text"
except TypeError:
    bad_concat = True
`);

    expect(machine.state).toMatchObject({ kind: "completed" });
    expect(machine.globals.get("parts")).toMatchObject({
      kind: "list",
      values: [
        "We have ",
        { kind: "namespace", name: "Interpolation" },
        { kind: "namespace", name: "Interpolation" },
      ],
    });
    expect(
      namespace(machine.globals.get("combined")).values.get("strings"),
    ).toMatchObject({
      kind: "tuple",
      values: ["left ", " right"],
    });
    expect(machine.globals.get("string_value")).toBe("3");
    expect(machine.globals.get("repr_value")).toBe("'text'");
    expect(machine.globals.get("ascii_value")).toBe("'\\xe9'");
    expect(machine.globals.get("bad_concat")).toBe(true);
    expect(machine.globals.get("template_check")).toBe(true);
    expect(machine.globals.get("interpolation_check")).toBe(true);
    expect(machine.globals.get("iterated")).toBe("We have cheesepunctuation");
  });

  it("binds the parent string package for a bare dotted import", (): void => {
    const machine = runPythonCs486Core(`
import string.templatelib
manual = string.templatelib.Template("ready")
template_check = isinstance(manual, string.templatelib.Template)
`);

    expect(machine.state).toMatchObject({ kind: "completed" });
    expect(
      namespace(machine.globals.get("manual")).values.get("strings"),
    ).toMatchObject({
      kind: "tuple",
      values: ["ready"],
    });
    expect(machine.globals.get("template_check")).toBe(true);
  });

  it("does not publish a partial template after an interpolation fault", (): void => {
    const machine = runPythonCs486Core(`
events = ""
def mark(value):
    global events
    events = events + str(value)
    return value
faulted = False
missing_candidate = False
try:
    candidate = t"{mark(1)}{unknown_name:{mark(2)}}"
except NameError:
    faulted = True
try:
    candidate
except NameError:
    missing_candidate = True
after = t"{mark(3)}"
`);

    expect(machine.state).toMatchObject({ kind: "completed" });
    expect(machine.globals.get("events")).toBe("13");
    expect(machine.globals.get("faulted")).toBe(true);
    expect(machine.globals.get("missing_candidate")).toBe(true);
    expect(
      namespace(machine.globals.get("after")).values.get("values"),
    ).toMatchObject({
      kind: "tuple",
      values: [3],
    });
  });

  it("binds Interpolation constructor keywords and rejects duplicates atomically", (): void => {
    const machine = runPythonCs486Core(`
from string.templatelib import Interpolation
keyword = Interpolation(expression="answer", value=42, format_spec="04d")
duplicate_rejected = False
conversion_rejected = False
try:
    Interpolation(1, "value", value=2)
except TypeError:
    duplicate_rejected = True
try:
    Interpolation(1, "value", conversion="q")
except ValueError:
    conversion_rejected = True
after = Interpolation(value="ready", expression="status")
`);

    expect(machine.state).toMatchObject({ kind: "completed" });
    const keyword = namespace(machine.globals.get("keyword"));
    expect(keyword.values.get("value")).toBe(42);
    expect(keyword.values.get("expression")).toBe("answer");
    expect(keyword.values.get("conversion")).toBeNull();
    expect(keyword.values.get("format_spec")).toBe("04d");
    expect(machine.globals.get("duplicate_rejected")).toBe(true);
    expect(machine.globals.get("conversion_rejected")).toBe(true);
    expect(namespace(machine.globals.get("after")).values.get("value")).toBe(
      "ready",
    );
  });

  it("matches Interpolation through its documented positional surface", (): void => {
    const machine = runPythonCs486Core(`
from string.templatelib import Interpolation

interpolation = t"{21 * 2!s:04d}".interpolations[0]
matched = False
match interpolation:
    case Interpolation(value, expression, conversion, format_spec):
        matched = value == 42 and expression == "21 * 2" and conversion == "s" and format_spec == "04d"
`);

    expect(machine.state).toMatchObject({ kind: "completed" });
    expect(machine.globals.get("matched")).toBe(true);
  });

  it("remains resumable under eight-instruction slices", (): void => {
    const machine = new PythonCs486CoreHarness(`
left = 20
right = 22
template = t"answer={left + right}"
answer = template.values[0]
`);
    let slices = 0;
    while (
      slices < 4_096 &&
      (machine.state.kind === "ready" || machine.hasPendingCpuCycles)
    ) {
      machine.runSlice(8);
      slices += 1;
    }
    expect(machine.state).toMatchObject({ kind: "completed" });
    expect(machine.globals.get("answer")).toBe(42);
    expect(slices).toBeGreaterThan(1);
  });

  it("rejects capacity-plus-one and invalid constructor parts without poisoning later work", (): void => {
    const machine = runPythonCs486Core(
      `
from string.templatelib import Template

invalid = False
over_capacity = False
try:
    Template(1)
except TypeError:
    invalid = True
exact = t"{1}"
try:
    t"{1}{2}"
except ResourceLimitError:
    over_capacity = True
after = t"ready"
`,
      {
        limits: { ...defaultPythonRuntimeLimits, maxCollectionSize: 2 },
      },
    );

    expect(machine.state).toMatchObject({ kind: "completed" });
    expect(machine.globals.get("invalid")).toBe(true);
    expect(machine.globals.get("over_capacity")).toBe(true);
    expect(namespace(machine.globals.get("exact")).name).toBe("Template");
    expect(namespace(machine.globals.get("after")).name).toBe("Template");
  });

  it("accounts retained templates in the managed heap", (): void => {
    const baseline = runPythonCs486Core("done = True\n");
    const retained = runPythonCs486Core(`
value = "retained interpolation payload"
template = t"prefix {value} suffix"
`);
    expect(retained.state).toMatchObject({ kind: "completed" });
    expect(retained.memoryUsageBytes).toBeGreaterThan(
      baseline.memoryUsageBytes,
    );
  });
});
