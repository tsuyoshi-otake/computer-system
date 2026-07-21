import { describe, expect, it } from "vitest";

import { InMemoryFilesystem } from "../../src/domain/filesystem/inMemoryFilesystem.js";
import { defaultPythonRuntimeLimits } from "../../src/application/runtime/pythonLimits.js";
import type {
  RuntimeList,
  RuntimeNamespace,
  RuntimeTuple,
} from "../../src/domain/runtime/value.js";
import { PythonCs486Harness, runPythonCs486 } from "./pythonCs486Harness.js";

const maximumModules = 64;
const maximumImportDepth = 16;
const maximumTotalSourceBytes = 512_000;

function packageFilesystem(): InMemoryFilesystem {
  const filesystem = new InMemoryFilesystem();
  filesystem.makeDirectory("/app");
  filesystem.makeDirectory("/app/pkg");
  filesystem.writeFile(
    "/app/pkg/__init__.py",
    'events = "p"\nvalue = 40\npublic = 7\n_hidden = 8\n__all__ = ["public"]\n',
  );
  filesystem.writeFile(
    "/app/pkg.py",
    'raise AssertionError("package file precedence was not preserved")\n',
  );
  filesystem.writeFile(
    "/app/pkg/tools.py",
    `
import pkg
from . import value
pkg.events = pkg.events + "t"
answer = value + 2
metadata = (__name__, __package__, __file__)
`,
  );
  return filesystem;
}

describe("Computer System Python regular packages", (): void => {
  it("initializes parents once and preserves dotted versus alias binding", (): void => {
    const filesystem = packageFilesystem();
    const machine = runPythonCs486(
      `
import pkg.tools
import pkg.tools as leaf
same_leaf = pkg.tools is leaf
answer = pkg.tools.answer
events = pkg.events
package_metadata = (pkg.__name__, pkg.__package__, pkg.__file__, pkg.__path__)
module_metadata = leaf.metadata
`,
      { filesystem, path: "/app/main.py" },
    );

    expect(machine.state.kind, JSON.stringify(machine.state)).toBe("completed");
    expect(machine.globals.get("same_leaf")).toBe(true);
    expect(machine.globals.get("answer")).toBe(42);
    expect(machine.globals.get("events")).toBe("pt");
    const packageMetadata = machine.globals.get(
      "package_metadata",
    ) as RuntimeTuple;
    expect(packageMetadata.values.slice(0, 3)).toEqual([
      "pkg",
      "pkg",
      "/app/pkg/__init__.py",
    ]);
    expect((packageMetadata.values[3] as RuntimeList).values).toEqual([
      "/app/pkg",
    ]);
    expect(
      (machine.globals.get("module_metadata") as RuntimeTuple).values,
    ).toEqual(["pkg.tools", "pkg", "/app/pkg/tools.py"]);
  });

  it("binds absolute, relative, parenthesized, fallback-submodule, and wildcard imports", (): void => {
    const filesystem = packageFilesystem();
    const machine = runPythonCs486(
      `
import pkg
from pkg import (value as base, tools)
from pkg.tools import answer as result
from pkg import *
same_tools = tools is pkg.tools
hidden_missing = False
try:
    _hidden
except NameError:
    hidden_missing = True
`,
      { filesystem, path: "/app/main.py" },
    );

    expect(machine.state.kind, JSON.stringify(machine.state)).toBe("completed");
    expect(machine.globals.get("base")).toBe(40);
    expect(machine.globals.get("result")).toBe(42);
    expect(machine.globals.get("public")).toBe(7);
    expect(machine.globals.get("same_tools")).toBe(true);
    expect(machine.globals.get("hidden_missing")).toBe(true);
  });

  it("publishes nested package chains on each parent namespace", (): void => {
    const filesystem = packageFilesystem();
    filesystem.makeDirectory("/app/pkg/sub");
    filesystem.writeFile("/app/pkg/sub/__init__.py", "kind = 'sub'\n");
    filesystem.writeFile("/app/pkg/sub/module.py", "value = 73\n");
    const machine = runPythonCs486(
      `
import pkg.sub.module
from pkg.sub import module as leaf
same = pkg.sub.module is leaf
value = leaf.value
`,
      { filesystem, path: "/app/main.py" },
    );

    expect(machine.state.kind, JSON.stringify(machine.state)).toBe("completed");
    expect(machine.globals.get("same")).toBe(true);
    expect(machine.globals.get("value")).toBe(73);
  });

  it("keeps circular namespaces partial and rolls failed imports back for retry", (): void => {
    const filesystem = packageFilesystem();
    filesystem.writeFile("/app/state.py", "ready = False\n");
    filesystem.writeFile(
      "/app/pkg/retry.py",
      `
import state
if not state.ready:
    raise ValueError("not ready")
value = 91
`,
    );
    filesystem.writeFile(
      "/app/pkg/cycle.py",
      "import pkg\npartial_name = pkg.__name__\n",
    );
    const machine = runPythonCs486(
      `
import pkg
from pkg import cycle
partial_name = cycle.partial_name
import state
failed = False
try:
    import pkg.retry
except ValueError:
    failed = True
unpublished = False
try:
    pkg.retry
except AttributeError:
    unpublished = True
state.ready = True
import pkg.retry
retried = pkg.retry.value
`,
      { filesystem, path: "/app/main.py" },
    );

    expect(machine.state.kind, JSON.stringify(machine.state)).toBe("completed");
    expect(machine.globals.get("partial_name")).toBe("pkg");
    expect(machine.globals.get("failed")).toBe(true);
    expect(machine.globals.get("unpublished")).toBe(true);
    expect(machine.globals.get("retried")).toBe(91);
    const pkg = machine.globals.get("pkg") as RuntimeNamespace;
    expect(pkg.values.get("retry")).toBeDefined();
  });

  it("rejects relative imports beyond the package root", (): void => {
    const filesystem = packageFilesystem();
    filesystem.writeFile("/app/pkg/bad.py", "from ..outside import value\n");

    expect(() =>
      runPythonCs486("import pkg.bad\n", {
        filesystem,
        path: "/app/main.py",
      }),
    ).toThrow(/attempted relative import beyond top-level package/u);
  });

  it("exports public names when __all__ is absent", (): void => {
    const filesystem = packageFilesystem();
    filesystem.makeDirectory("/app/plain");
    filesystem.writeFile(
      "/app/plain/__init__.py",
      "visible = 11\n_hidden = 12\n",
    );
    const machine = runPythonCs486(
      `
from plain import *
hidden_missing = False
try:
    _hidden
except NameError:
    hidden_missing = True
`,
      { filesystem, path: "/app/main.py" },
    );

    expect(machine.state.kind, JSON.stringify(machine.state)).toBe("completed");
    expect(machine.globals.get("visible")).toBe(11);
    expect(machine.globals.get("hidden_missing")).toBe(true);
  });

  it("reports missing selected attributes as ImportError", (): void => {
    const machine = runPythonCs486("from pkg import absent\n", {
      filesystem: packageFilesystem(),
      path: "/app/main.py",
    });

    expect(machine.state.kind).toBe("crashed");
    if (machine.state.kind === "crashed") {
      expect(machine.state.error.typeName).toBe("ImportError");
      expect(machine.state.error.message).toContain(
        "cannot import name absent",
      );
    }
  });

  it("accepts the module-count boundary and rejects capacity plus one", (): void => {
    const filesystem = new InMemoryFilesystem();
    filesystem.makeDirectory("/app");
    const names = Array.from(
      { length: maximumModules - 1 },
      (_, index) => `module_${String(index)}`,
    );
    for (const [index, name] of names.entries()) {
      filesystem.writeFile(`/app/${name}.py`, `value = ${String(index)}\n`);
    }
    const source = `import ${names.join(", ")}\n`;

    const machine = runPythonCs486(source, {
      filesystem,
      path: "/app/main.py",
    });
    expect(machine.state.kind, JSON.stringify(machine.state)).toBe("completed");

    filesystem.writeFile("/app/overflow.py", "value = 64\n");
    expect(
      () =>
        new PythonCs486Harness(`${source}import overflow\n`, {
          filesystem,
          path: "/app/main.py",
        }),
    ).toThrow(/module count limit exceeded/u);
  });

  it("accepts import depth 16 and rejects depth 17", (): void => {
    const filesystem = new InMemoryFilesystem();
    filesystem.makeDirectory("/app");
    for (let index = 0; index < maximumImportDepth; index += 1) {
      const next =
        index + 1 === maximumImportDepth
          ? "value = 16\n"
          : `import depth_${String(index + 1)}\n`;
      filesystem.writeFile(`/app/depth_${String(index)}.py`, next);
    }

    const machine = runPythonCs486("import depth_0\n", {
      filesystem,
      path: "/app/main.py",
    });
    expect(machine.state.kind, JSON.stringify(machine.state)).toBe("completed");

    filesystem.writeFile(
      `/app/depth_${String(maximumImportDepth - 1)}.py`,
      `import depth_${String(maximumImportDepth)}\n`,
    );
    filesystem.writeFile(
      `/app/depth_${String(maximumImportDepth)}.py`,
      "value = 17\n",
    );
    expect(
      () =>
        new PythonCs486Harness("import depth_0\n", {
          filesystem,
          path: "/app/main.py",
        }),
    ).toThrow(/import depth limit exceeded/u);
  });

  it("accepts the aggregate source boundary and rejects one byte more", (): void => {
    const mainSource = "import payload\n";
    const filesystem = new InMemoryFilesystem();
    filesystem.makeDirectory("/app");
    filesystem.writeFile(
      "/app/payload.py",
      "#".repeat(maximumTotalSourceBytes - mainSource.length),
    );

    const machine = runPythonCs486(mainSource, {
      filesystem,
      path: "/app/main.py",
    });
    expect(machine.state.kind, JSON.stringify(machine.state)).toBe("completed");

    filesystem.writeFile(
      "/app/payload.py",
      "#".repeat(maximumTotalSourceBytes - mainSource.length + 1),
    );
    expect(
      () =>
        new PythonCs486Harness(mainSource, {
          filesystem,
          path: "/app/main.py",
        }),
    ).toThrow(/module source limit exceeded/u);
  });

  it("keeps nested module calls under the shared call-depth limit", (): void => {
    const filesystem = new InMemoryFilesystem();
    filesystem.makeDirectory("/app");
    filesystem.makeDirectory("/app/callpkg");
    filesystem.writeFile(
      "/app/callpkg/__init__.py",
      `
def outer():
    return inner()
def inner():
    return 1
value = outer()
`,
    );
    const limited = runPythonCs486("import callpkg\n", {
      filesystem,
      limits: { ...defaultPythonRuntimeLimits, maxCallDepth: 1 },
      path: "/app/main.py",
    });

    expect(limited.state.kind).toBe("crashed");
    if (limited.state.kind === "crashed") {
      expect(limited.state.error.typeName).toBe("ResourceLimitError");
      expect(limited.state.error.message).toContain(
        "call depth limit exceeded",
      );
    }

    const admitted = runPythonCs486("import callpkg\n", {
      filesystem,
      limits: { ...defaultPythonRuntimeLimits, maxCallDepth: 2 },
      path: "/app/main.py",
    });
    expect(admitted.state.kind, JSON.stringify(admitted.state)).toBe(
      "completed",
    );
  });

  it("preflights child publication against the package namespace limit", (): void => {
    const filesystem = new InMemoryFilesystem();
    filesystem.makeDirectory("/app");
    filesystem.makeDirectory("/app/cap");
    filesystem.writeFile("/app/cap/__init__.py", "pass\n");
    filesystem.writeFile("/app/cap/child.py", "pass\n");
    const rejected = runPythonCs486("import cap.child\n", {
      filesystem,
      limits: { ...defaultPythonRuntimeLimits, maxCollectionSize: 4 },
      path: "/app/main.py",
    });

    expect(rejected.state.kind).toBe("crashed");
    if (rejected.state.kind === "crashed") {
      expect(rejected.state.error.typeName).toBe("ResourceLimitError");
      expect(rejected.state.error.message).toContain(
        "module namespace limit exceeded",
      );
    }

    const admitted = runPythonCs486("import cap.child\n", {
      filesystem,
      limits: { ...defaultPythonRuntimeLimits, maxCollectionSize: 5 },
      path: "/app/main.py",
    });
    expect(admitted.state.kind, JSON.stringify(admitted.state)).toBe(
      "completed",
    );
  });

  it("keeps loaded package namespaces in shared managed-heap accounting", (): void => {
    const machine = new PythonCs486Harness("import pkg.tools\n", {
      filesystem: packageFilesystem(),
      path: "/app/main.py",
    });
    const before = machine.program.runtime.memoryUsageBytes;
    for (
      let slices = 0;
      slices < 1_000 &&
      (machine.state.kind === "ready" || machine.hasPendingCpuCycles);
      slices += 1
    ) {
      machine.runCpuSlice(100_000);
    }

    expect(machine.state.kind, JSON.stringify(machine.state)).toBe("completed");
    expect(machine.program.runtime.memoryUsageBytes).toBeGreaterThan(before);
    const pkg = machine.globals.get("pkg") as RuntimeNamespace;
    expect(pkg.values.get("tools")).toBeDefined();
  });

  it("advances package initialization through bounded CS486 slices", (): void => {
    const machine = new PythonCs486Harness("import pkg.tools\n", {
      filesystem: packageFilesystem(),
      path: "/app/main.py",
    });

    const first = machine.runCpuSlice(1, 1);
    expect(first.state.kind).toBe("ready");
    let slices = 1;
    while (
      slices < 20_000 &&
      (machine.state.kind === "ready" || machine.hasPendingCpuCycles)
    ) {
      machine.runCpuSlice(16, 1);
      slices += 1;
    }

    expect(slices).toBeGreaterThan(1);
    expect(slices).toBeLessThan(20_000);
    expect(machine.state.kind, JSON.stringify(machine.state)).toBe("completed");
  });
});
