import { describe, expect, it } from "vitest";

import { defaultPythonRuntimeLimits } from "../../src/application/runtime/pythonLimits.js";
import { InMemoryFilesystem } from "../../src/domain/filesystem/inMemoryFilesystem.js";
import {
  PythonCs486CoreHarness,
  runPythonCs486Core,
} from "./pythonCs486CoreHarness.js";

describe("Computer System Python 3.14 deferred annotations", (): void => {
  it("defers function annotations, resolves forward names, and caches success", (): void => {
    const machine = runPythonCs486Core(`
calls = 0
def mark(value):
    global calls
    calls = calls + 1
    return value
def sample(first: mark(Later), second: mark(2)) -> mark(3):
    return first
before = calls
class Later:
    pass
annotations = sample.__annotations__
after = calls
same = sample.__annotations__ is annotations
again = calls
first_ok = annotations["first"] is Later
second_value = annotations["second"]
return_value = annotations["return"]
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("before")).toBe(0);
    expect(machine.globals.get("after")).toBe(3);
    expect(machine.globals.get("again")).toBe(3);
    expect(machine.globals.get("same")).toBe(true);
    expect(machine.globals.get("first_ok")).toBe(true);
    expect(machine.globals.get("second_value")).toBe(2);
    expect(machine.globals.get("return_value")).toBe(3);
  });

  it("retries a failed evaluation and captures an enclosing function cell", (): void => {
    const machine = runPythonCs486Core(`
def unresolved(value: Missing):
    return value
failed = False
try:
    unresolved.__annotations__
except NameError:
    failed = True
Missing = 17
retried = unresolved.__annotations__["value"]
def outer():
    Local = 40
    def nested(value: Local + 2):
        return value
    return nested
nested = outer()
closed_over = nested.__annotations__["value"]
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("failed")).toBe(true);
    expect(machine.globals.get("retried")).toBe(17);
    expect(machine.globals.get("closed_over")).toBe(42);
  });

  it("forwards enclosing cells into functions created inside annotation scopes", (): void => {
    const machine = runPythonCs486Core(`
def outer():
    captured = 23
    def sample(value: (lambda: captured)):
        return value
    return sample
sample = outer()
factory = sample.__annotations__["value"]
result = factory()
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("result")).toBe(23);
  });

  it("uses the completed class namespace for class and method annotation scopes", (): void => {
    const machine = runPythonCs486Core(`
class Base:
    inherited: 1
class Sample(Base):
    field: Later
    MethodType = 30
    def method(self, value: MethodType) -> MethodType + 1:
        return value
    Later = 20
field = Sample.__annotations__["field"]
method_annotations = Sample.method.__annotations__
parameter = method_annotations["value"]
returned = method_annotations["return"]
class Empty(Sample):
    pass
empty_size = len(Empty.__annotations__)
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("field")).toBe(20);
    expect(machine.globals.get("parameter")).toBe(30);
    expect(machine.globals.get("returned")).toBe(31);
    expect(machine.globals.get("empty_size")).toBe(0);
  });

  it("never evaluates non-simple annotations but preserves target/RHS order", (): void => {
    const machine = runPythonCs486Core(`
events = 0
items = [0]
def note(tag):
    global events
    events = events * 10 + tag
    return tag
def target():
    note(1)
    return items
def index():
    note(2)
    return 0
target()[index()]: missing_annotation
after_bare = events
target()[index()]: another_missing = note(3)
after_store = events
stored = items[0]
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("after_bare")).toBe(12);
    expect(machine.globals.get("after_store")).toBe(12312);
    expect(machine.globals.get("stored")).toBe(3);
  });

  it("honors global/nonlocal binding and keeps successful dictionaries mutable", (): void => {
    const machine = runPythonCs486Core(`
global_value = 1
def update_global():
    global global_value
    global_value: NeverEvaluated = 2
def outer():
    value = 3
    def update():
        nonlocal value
        value: AlsoNeverEvaluated = 4
    update()
    return value
def sample(value: 5):
    return value
update_global()
nonlocal_value = outer()
annotations = sample.__annotations__
annotations["value"] = 6
mutated = sample.__annotations__["value"]
same = sample.__annotations__ is annotations
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("global_value")).toBe(2);
    expect(machine.globals.get("nonlocal_value")).toBe(4);
    expect(machine.globals.get("mutated")).toBe(6);
    expect(machine.globals.get("same")).toBe(true);
  });

  it("collects only executed module/class annotations and ignores function locals", (): void => {
    const machine = runPythonCs486Core(`
module_type = 10
if True:
    present: module_type
if False:
    absent: 99
module_annotations = __annotations__
module_present = module_annotations["present"]
class Sample:
    ClassType = 20
    field: ClassType
    if True:
        selected: ClassType + 1
    if False:
        skipped: 99
class_annotations = Sample.__annotations__
class_field = class_annotations["field"]
class_selected = class_annotations["selected"]
class_size = len(class_annotations)
calls = 0
def mark(value):
    global calls
    calls = calls + 1
    return value
def local_annotations():
    ignored: mark(1)
    return None
local_annotations()
local_size = len(local_annotations.__annotations__)
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("module_present")).toBe(10);
    expect(machine.globals.get("class_field")).toBe(20);
    expect(machine.globals.get("class_selected")).toBe(21);
    expect(machine.globals.get("class_size")).toBe(2);
    expect(machine.globals.get("calls")).toBe(0);
    expect(machine.globals.get("local_size")).toBe(0);
  });

  it("does not cache annotations observed through a partially initialized module", (): void => {
    const filesystem = new InMemoryFilesystem();
    filesystem.makeDirectory("/app");
    filesystem.writeFile("/app/a.py", "first: 1\nimport b\nsecond: 2\n");
    filesystem.writeFile(
      "/app/b.py",
      "import a\npartial_size = len(a.__annotations__)\n",
    );
    const machine = runPythonCs486Core(
      `
import a
import b
partial_size = b.partial_size
final_size = len(a.__annotations__)
first = a.__annotations__["first"]
second = a.__annotations__["second"]
`,
      { filesystem, path: "/app/main.py" },
    );

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("partial_size")).toBe(1);
    expect(machine.globals.get("final_size")).toBe(2);
    expect(machine.globals.get("first")).toBe(1);
    expect(machine.globals.get("second")).toBe(2);
  });

  it("rejects capacity plus one during lazy publication without an eager fault", (): void => {
    const source = `
def sample(first: 1, second: 2):
    pass
defined = True
sample.__annotations__
`;
    const machine = runPythonCs486Core(source, {
      limits: { ...defaultPythonRuntimeLimits, maxCollectionSize: 1 },
    });
    expect(machine.globals.get("defined")).toBe(true);
    expect(machine.state).toMatchObject({
      error: { typeName: "ResourceLimitError" },
      kind: "crashed",
    });

    const exact = runPythonCs486Core(
      `
def sample(value: 1):
    pass
size = len(sample.__annotations__)
`,
      {
        limits: { ...defaultPythonRuntimeLimits, maxCollectionSize: 1 },
      },
    );
    expect(exact.state.kind).toBe("completed");
    expect(exact.globals.get("size")).toBe(1);
  });

  it("remains resumable under small CS486 instruction slices", (): void => {
    const machine = new PythonCs486CoreHarness(`
def sample(value: Later) -> Later:
    return value
class Later:
    pass
result = sample.__annotations__["value"] is Later
`);
    let slices = 0;
    while (
      slices < 2_000 &&
      (machine.state.kind === "ready" || machine.hasPendingCpuCycles)
    ) {
      machine.runSlice(8);
      slices += 1;
    }
    expect(slices).toBeGreaterThan(1);
    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("result")).toBe(true);
  });
});
