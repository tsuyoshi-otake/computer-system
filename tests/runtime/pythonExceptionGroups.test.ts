import { describe, expect, it } from "vitest";

import { defaultPythonRuntimeLimits } from "../../src/application/runtime/pythonLimits.js";
import type { RuntimeNamespace } from "../../src/domain/runtime/value.js";
import {
  PythonCs486CoreHarness,
  runPythonCs486Core,
} from "./pythonCs486CoreHarness.js";

function namespace(value: unknown): RuntimeNamespace {
  expect(value).toMatchObject({ kind: "namespace" });
  return value as RuntimeNamespace;
}

describe("Computer System Python 3.14 exception groups", (): void => {
  it("constructs nested groups and exposes derive, subgroup, and split", (): void => {
    const machine = runPythonCs486Core(`
value = ValueError("value")
type_error = TypeError("type")
group = ExceptionGroup("root", (value, type_error))
matched = group.subgroup(ValueError)
split_match, split_rest = group.split(ValueError)
derived = group.derive((type_error,))
base = BaseExceptionGroup("base", (GeneratorExit(), value))
auto = BaseExceptionGroup("auto", (value,))
group.__cause__ = KeyError("cause")
group.__context__ = RuntimeError("context")
group.__notes__ = ("note",)
metadata = group.subgroup(ValueError)
metadata_derived = group.derive((value,))
read_only = False
try:
    group.message = "changed"
except AttributeError:
    read_only = True
`);

    expect(
      machine.state,
      machine.state.kind === "crashed"
        ? `${machine.state.error.typeName}: ${machine.state.error.message}`
        : JSON.stringify(machine.state),
    ).toMatchObject({
      kind: "completed",
    });
    const group = namespace(machine.globals.get("group"));
    expect(group.name).toBe("ExceptionGroup");
    expect(group.values.get("message")).toBe("root");
    expect(namespace(machine.globals.get("matched")).name).toBe(
      "ExceptionGroup",
    );
    expect(
      namespace(machine.globals.get("split_match")).values.get("message"),
    ).toBe("root");
    expect(namespace(machine.globals.get("split_rest")).name).toBe(
      "ExceptionGroup",
    );
    expect(
      namespace(machine.globals.get("derived")).values.get("message"),
    ).toBe("root");
    expect(namespace(machine.globals.get("base")).name).toBe(
      "BaseExceptionGroup",
    );
    expect(namespace(machine.globals.get("auto")).name).toBe("ExceptionGroup");
    const metadata = namespace(machine.globals.get("metadata"));
    expect(namespace(metadata.values.get("__cause__")).name).toBe("KeyError");
    expect(namespace(metadata.values.get("__context__")).name).toBe(
      "RuntimeError",
    );
    expect(metadata.values.get("__notes__")).toMatchObject({
      kind: "tuple",
      values: ["note"],
    });
    const metadataDerived = namespace(machine.globals.get("metadata_derived"));
    expect(namespace(metadataDerived.values.get("__cause__")).name).toBe(
      "KeyError",
    );
    expect(machine.globals.get("read_only")).toBe(true);
  });

  it("splits nested trees across ordered except-star handlers", (): void => {
    const machine = runPythonCs486Core(`
value_seen = False
type_seen = False
nested_shape = False
try:
    raise ExceptionGroup("root", (
        ValueError("a"),
        ExceptionGroup("nested", (TypeError("b"), ValueError("c"))),
    ))
except* ValueError as errors:
    value_seen = errors.type == "ExceptionGroup"
    nested_shape = errors.exceptions[1].message == "nested"
except* TypeError as errors:
    type_seen = errors.exceptions[0].message == "nested"
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("value_seen")).toBe(true);
    expect(machine.globals.get("type_seen")).toBe(true);
    expect(machine.globals.get("nested_shape")).toBe(true);
  });

  it("runs callable subgroup predicates through managed CS486 calls", (): void => {
    const machine = runPythonCs486Core(`
visits = 0
def value_errors(error):
    global visits
    visits = visits + 1
    return isinstance(error, ValueError)
group = ExceptionGroup("root", (ValueError("a"), TypeError("b")))
matched, rest = group.split(value_errors)
matched_type = matched.exceptions[0].type
rest_type = rest.exceptions[0].type
predicate_fault = False
def fail(_error):
    raise RuntimeError("predicate")
try:
    group.subgroup(fail)
except RuntimeError as error:
    predicate_fault = error.message == "predicate"
after = group.subgroup(ValueError)
`);

    expect(machine.state).toMatchObject({ kind: "completed" });
    expect(machine.globals.get("visits")).toBe(3);
    expect(machine.globals.get("matched_type")).toBe("ValueError");
    expect(machine.globals.get("rest_type")).toBe("TypeError");
    expect(machine.globals.get("predicate_fault")).toBe(true);
    expect(namespace(machine.globals.get("after")).name).toBe("ExceptionGroup");
  });

  it("temporarily wraps ordinary exceptions and reraises unmatched ones naked", (): void => {
    const matched = runPythonCs486Core(`
wrapped = False
try:
    raise ValueError("plain")
except* ValueError as errors:
    wrapped = errors.type == "ExceptionGroup" and errors.exceptions[0].type == "ValueError"
`);
    expect(matched.state).toMatchObject({ kind: "completed" });
    expect(matched.globals.get("wrapped")).toBe(true);

    const unmatched = runPythonCs486Core(`
try:
    raise ValueError("plain")
except* TypeError:
    pass
`);
    expect(unmatched.state.kind).toBe("crashed");
    if (unmatched.state.kind === "crashed") {
      expect(unmatched.state.error.typeName).toBe("ValueError");
    }
  });

  it("merges newly raised and unmatched exceptions before the outer handler", (): void => {
    const machine = runPythonCs486Core(`
first = ""
second = ""
finalized = 0
try:
    try:
        raise ExceptionGroup("root", (ValueError("a"), TypeError("b")))
    except* ValueError:
        raise KeyError("new")
    finally:
        finalized = finalized + 1
except BaseExceptionGroup as merged:
    first = merged.exceptions[0].type
    second = merged.exceptions[1].type
`);

    expect(machine.state).toMatchObject({ kind: "completed" });
    expect(machine.globals.get("first")).toBe("KeyError");
    expect(machine.globals.get("second")).toBe("ExceptionGroup");
    expect(machine.globals.get("finalized")).toBe(1);
  });

  it("preserves the original tree when matched subgroups are reraised", (): void => {
    const machine = runPythonCs486Core(`
original = ExceptionGroup("original", (
    ValueError("v"),
    ExceptionGroup("nested", (TypeError("t"),)),
))
try:
    try:
        raise original
    except* ValueError:
        raise
    except* TypeError:
        raise
except ExceptionGroup as reraised:
    same = reraised is original
    message = reraised.message
    nested_message = reraised.exceptions[1].message
`);

    expect(machine.state).toMatchObject({ kind: "completed" });
    expect(machine.globals.get("same")).toBe(true);
    expect(machine.globals.get("message")).toBe("original");
    expect(machine.globals.get("nested_message")).toBe("nested");
  });

  it("does not wrap one new exception after the entire group is handled", (): void => {
    const machine = runPythonCs486Core(`
try:
    try:
        raise ExceptionGroup("root", (ValueError("v"),))
    except* ValueError:
        raise KeyError("new")
except KeyError as caught:
    caught_message = caught.message
`);

    expect(machine.state).toMatchObject({ kind: "completed" });
    expect(machine.globals.get("caught_message")).toBe("new");
  });

  it("supports group class checks and rejects group types in except-star", (): void => {
    const machine = runPythonCs486Core(`
group = ExceptionGroup("root", (ValueError("v"),))
instance_check = isinstance(group, BaseExceptionGroup)
subclass_check = issubclass(ExceptionGroup, BaseExceptionGroup)
invalid = False
try:
    try:
        raise group
    except* ExceptionGroup:
        pass
except TypeError:
    invalid = True
read_only = False
try:
    group.exceptions = ()
except AttributeError:
    read_only = True
`);

    expect(machine.state).toMatchObject({ kind: "completed" });
    expect(machine.globals.get("instance_check")).toBe(true);
    expect(machine.globals.get("subclass_check")).toBe(true);
    expect(machine.globals.get("invalid")).toBe(true);
    expect(machine.globals.get("read_only")).toBe(true);
  });

  it("runs callable subgroup and split conditions through managed calls", (): void => {
    const machine = runPythonCs486Core(`
events = ""
group = ExceptionGroup("root", (ValueError("v"), TypeError("t")))
def choose(error):
    global events
    events = events + error.type[0]
    return error.type == "ValueError"
matched = group.subgroup(choose)
parts = group.split(lambda error: error.type == "TypeError")
matched_type = matched.exceptions[0].type
split_type = parts[0].exceptions[0].type
rest_type = parts[1].exceptions[0].type
`);

    expect(
      machine.state,
      machine.state.kind === "crashed"
        ? `${machine.state.error.typeName}: ${machine.state.error.message}`
        : JSON.stringify(machine.state),
    ).toMatchObject({
      kind: "completed",
    });
    expect(machine.globals.get("events")).toBe("EVT");
    expect(machine.globals.get("matched_type")).toBe("ValueError");
    expect(machine.globals.get("split_type")).toBe("TypeError");
    expect(machine.globals.get("rest_type")).toBe("ValueError");
  });

  it("routes a callable-condition fault through the ordinary exception owner", (): void => {
    const machine = runPythonCs486Core(`
group = ExceptionGroup("root", (ValueError("v"),))
def fail(error):
    raise KeyError(error.message)
caught = False
try:
    group.subgroup(fail)
except KeyError as error:
    caught = error.message == "root"
`);

    expect(machine.state).toMatchObject({ kind: "completed" });
    expect(machine.globals.get("caught")).toBe(true);
  });

  it("retains except-star continuation state across generator suspension", (): void => {
    const machine = runPythonCs486Core(`
completed = False
def grouped():
    global completed
    try:
        raise ExceptionGroup("root", (ValueError("a"),))
    except* ValueError as errors:
        yield errors.message
        completed = True
generator = grouped()
first = next(generator)
try:
    next(generator)
except StopIteration:
    stopped = True
`);

    expect(machine.state).toMatchObject({ kind: "completed" });
    expect(machine.globals.get("first")).toBe("root");
    expect(machine.globals.get("completed")).toBe(true);
    expect(machine.globals.get("stopped")).toBe(true);
  });

  it("finalizes a suspended except-star handler exactly once on generator close", (): void => {
    const machine = runPythonCs486Core(`
handler_finalized = 0
outer_finalized = 0
def grouped():
    global handler_finalized, outer_finalized
    try:
        try:
            raise ExceptionGroup("root", (ValueError("a"),))
        except* ValueError:
            try:
                yield "paused"
            finally:
                handler_finalized = handler_finalized + 1
    finally:
        outer_finalized = outer_finalized + 1
generator = grouped()
first = next(generator)
generator.close()
closed = generator.close()
`);

    expect(machine.state).toMatchObject({ kind: "completed" });
    expect(machine.globals.get("first")).toBe("paused");
    expect(machine.globals.get("handler_finalized")).toBe(1);
    expect(machine.globals.get("outer_finalized")).toBe(1);
    expect(machine.globals.get("closed")).toBe(null);
  });

  it("retains except-star state through an awaited managed coroutine", (): void => {
    const machine = runPythonCs486Core(`
async def immediate():
    return 7
async def grouped():
    result = ""
    try:
        raise ExceptionGroup("root", (ValueError("a"),))
    except* ValueError as errors:
        value = await immediate()
        result = errors.message + ":" + str(value)
    return result
coroutine = grouped()
try:
    coroutine.send(None)
except StopIteration as stopped:
    result = stopped.value
`);

    expect(machine.state).toMatchObject({ kind: "completed" });
    expect(machine.globals.get("result")).toBe("root:7");
  });

  it("rejects invalid trees and capacity-plus-one without poisoning later work", (): void => {
    const machine = runPythonCs486Core(
      `
invalid_item = False
invalid_exception_group = False
over_capacity = False
try:
    BaseExceptionGroup("bad", (1,))
except TypeError:
    invalid_item = True
try:
    ExceptionGroup("bad", (GeneratorExit(),))
except TypeError:
    invalid_exception_group = True
a = ValueError("a")
b = TypeError("b")
left = ExceptionGroup("left", (a, b))
exact = ExceptionGroup("exact", (left, a))
try:
    ExceptionGroup("too many", (left, a, b))
except ResourceLimitError:
    over_capacity = True
after = ExceptionGroup("after", (a,))
`,
      {
        limits: { ...defaultPythonRuntimeLimits, maxCollectionSize: 4 },
      },
    );

    expect(machine.state).toMatchObject({ kind: "completed" });
    expect(machine.globals.get("invalid_item")).toBe(true);
    expect(machine.globals.get("invalid_exception_group")).toBe(true);
    expect(machine.globals.get("over_capacity")).toBe(true);
    expect(namespace(machine.globals.get("exact")).name).toBe("ExceptionGroup");
    expect(namespace(machine.globals.get("after")).name).toBe("ExceptionGroup");
  });

  it("advances through except-star work under eight-instruction slices", (): void => {
    const machine = new PythonCs486CoreHarness(`
handled = False
try:
    raise ExceptionGroup("root", (ValueError("a"), TypeError("b")))
except* ValueError:
    handled = True
except* TypeError:
    handled = handled and True
`);
    let slices = 0;
    while (
      slices < 4_096 &&
      (machine.state.kind === "ready" || machine.hasPendingCpuCycles)
    ) {
      machine.runSlice(8);
      slices += 1;
    }
    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("handled")).toBe(true);
    expect(slices).toBeGreaterThan(1);
  });

  it("accounts reachable exception groups in the managed heap", (): void => {
    const baseline = runPythonCs486Core("done = True\n");
    const grouped = runPythonCs486Core(`
group = ExceptionGroup("root", (
    ValueError("a long retained message"),
    TypeError("another long retained message"),
))
`);
    expect(grouped.state.kind).toBe("completed");
    expect(grouped.memoryUsageBytes).toBeGreaterThan(baseline.memoryUsageBytes);
  });
});
