import { describe, expect, it } from "vitest";

import {
  ComputerRuntime,
  type DebugShellCommandCompletion,
} from "../../src/application/computer/computerRuntime.js";
import {
  ComputerRecord,
  type ComputerSnapshot,
} from "../../src/domain/computer/computer.js";
import {
  advancedComputerHardware,
  portableComputerHardware,
} from "../../src/domain/computer/hardware.js";

describe("ComputerRuntime", (): void => {
  it("holds guest input and CPU through staged POST before startup completes", (): void => {
    const record = computer(
      "computer-1",
      'import term\nterm.write("booted")\n',
    );
    const runtime = runtimeWith(record);
    expect(runtime.powerOn(record.computerId)).toMatchObject({
      outcome: "accepted",
      state: "booting",
    });
    expect(runtime.queueEvent(record.computerId, "key", 42)).toMatchObject({
      outcome: "ignored",
      reason: "not_running",
    });
    expect(
      runtime.executeDebugShellCommand(record.computerId, "pwd"),
    ).toMatchObject({ outcome: "ignored", reason: "not_running" });
    runTicks(runtime, 70);
    expect(record.lifecycle.state).toEqual({ kind: "booting" });
    expect(record.display.state.kind).toBe("post");
    expect(record.terminal.snapshot().rows.join("\n")).not.toContain("booted");
    expect(completeBootCycle(runtime, record)).toBe(1);
    runTicks(runtime, 12);
    expect(record.lifecycle.state).toEqual({ kind: "off" });
    expect(
      record.terminal.snapshot().rows.some((line) => /^booted/u.test(line)),
    ).toBe(true);
  });

  it("runs a bounded MicroPython file through the MCP debug path", (): void => {
    const record = computer(
      "c-000001",
      "import os\nos.pull_event()\n",
      8 * 1_024 * 1_024,
    );
    const runtime = runtimeWith(record);
    runtime.powerOn(record.computerId);
    completeBootCycle(runtime, record);
    record.filesystem.writeFile("/tmp/demo.py", "print(6 * 7)\n");

    const result = runtime.executeDebugShellCommand(
      record.computerId,
      "python /tmp/demo.py",
    );
    expect(result).toMatchObject({
      outcome: "completed",
      exitCode: 0,
      stdout: "42\n",
    });
    expect(result.outcome === "completed" && result.stderr).toMatch(
      /^Python\/CS486DX: \d+ machine instructions, \d+ CPU cycles, \d+\.\d{3} us at 33 MHz/u,
    );
    if (result.outcome === "completed") {
      expect(result.cpuCycles).toBeGreaterThan(20);
    }
  });

  it("runs template strings through the production Python command and returns RAM to baseline", (): void => {
    const record = computer(
      "c-000096",
      "import os\nos.pull_event()\n",
      8 * 1_024 * 1_024,
    );
    const runtime = runtimeWith(record);
    runtime.powerOn(record.computerId);
    completeBootCycle(runtime, record);
    const baseline = runtime.guestMemoryStatus(record.computerId)?.usedBytes;
    expect(baseline).toBeGreaterThan(0);
    record.filesystem.writeFile(
      "/tmp/template.py",
      [
        "from string.templatelib import Template",
        'template = t"left={40 + 2!s:04d}"',
        "print(template.strings[0])",
        "print(template.values[0])",
        "print(template.interpolations[0].format_spec)",
        "print(isinstance(template, Template))",
        "",
      ].join("\n"),
    );

    const result = runtime.executeDebugShellCommand(
      record.computerId,
      "python /tmp/template.py",
    );

    expect(result).toMatchObject({ exitCode: 0, outcome: "completed" });
    if (result.outcome === "completed") {
      expect(
        result.stdout
          .split("\n")
          .map((line) => line.trimEnd())
          .join("\n"),
      ).toBe("left=\n42\n04d\nTrue\n");
    }
    expect(runtime.guestMemoryStatus(record.computerId)?.usedBytes).toBe(
      baseline,
    );
  });

  it("runs descriptors, attribute hooks, and deletion through production Python and returns RAM to baseline", (): void => {
    const record = computer(
      "c-000097",
      "import os\nos.pull_event()\n",
      8 * 1_024 * 1_024,
    );
    const runtime = runtimeWith(record);
    runtime.powerOn(record.computerId);
    completeBootCycle(runtime, record);
    const baseline = runtime.guestMemoryStatus(record.computerId)?.usedBytes;
    expect(baseline).toBeGreaterThan(0);
    record.filesystem.writeFile(
      "/tmp/descriptors.py",
      [
        "class Field:",
        "    def __set_name__(self, owner, name):",
        "        self.storage = '_' + name",
        "    def __get__(self, instance, owner):",
        "        if instance is None:",
        "            return owner.__name__",
        "        return instance._value",
        "    def __set__(self, instance, value):",
        "        instance._value = value",
        "    def __delete__(self, instance):",
        "        del instance._value",
        "class Base:",
        "    value = Field()",
        "    def __getattribute__(self, name):",
        "        if name == 'answer':",
        "            return 44",
        "        return object.__getattribute__(self, name)",
        "    def __getattr__(self, name):",
        "        if name == 'virtual':",
        "            return 45",
        "        raise AttributeError(name)",
        "    def __setattr__(self, name, value):",
        "        object.__setattr__(self, name, value)",
        "    def __delattr__(self, name):",
        "        object.__delattr__(self, name)",
        "    @property",
        "    def score(self):",
        "        return self._score",
        "    @score.setter",
        "    def score(self, value):",
        "        self._score = value",
        "    @score.deleter",
        "    def score(self):",
        "        del self._score",
        "    @staticmethod",
        "    def add(left, right):",
        "        return left + right",
        "    @classmethod",
        "    def owner(cls):",
        "        return cls.__name__",
        "    def method(self):",
        "        return self.value",
        "class Child(Base):",
        "    pass",
        "item = Child()",
        "item.value = 42",
        "item.score = 43",
        "bound = item.method",
        "print(item.value)",
        "print(item.score)",
        "print(Child.value)",
        "print(item.add(3, 4))",
        "print(item.owner())",
        "print(bound.__self__ is item and bound.__func__ is Base.method)",
        "print(item.answer)",
        "print(item.virtual)",
        "print(setattr(item, 'scratch', 46) is None)",
        "print(getattr(item, 'scratch'))",
        "print(delattr(item, 'scratch') is None)",
        "print(getattr(item, 'scratch', 47))",
        "del item.score",
        "print(getattr(item, '_score', 48))",
        "del item.value",
        "print(getattr(item, '_value', 49))",
        "",
      ].join("\n"),
    );

    const result = runtime.executeDebugShellCommand(
      record.computerId,
      "python /tmp/descriptors.py",
    );

    expect(result).toMatchObject({ exitCode: 0, outcome: "completed" });
    if (result.outcome === "completed") {
      expect(
        result.stdout
          .split("\n")
          .map((line) => line.trimEnd())
          .join("\n"),
      ).toBe(
        "42\n43\nChild\n7\nChild\nTrue\n44\n45\nTrue\n46\nTrue\n47\n48\n49\n",
      );
    }
    expect(runtime.guestMemoryStatus(record.computerId)?.usedBytes).toBe(
      baseline,
    );
  });

  it("runs C3 and cooperative super through production Python and returns RAM to baseline", (): void => {
    const record = computer(
      "c-000100",
      "import os\nos.pull_event()\n",
      8 * 1_024 * 1_024,
    );
    const runtime = runtimeWith(record);
    runtime.powerOn(record.computerId);
    completeBootCycle(runtime, record);
    const baseline = runtime.guestMemoryStatus(record.computerId)?.usedBytes;
    expect(baseline).toBeGreaterThan(0);
    record.filesystem.writeFile(
      "/tmp/mro.py",
      [
        "class Root:",
        "    value = 40",
        "    def chain(self):",
        '        return "R"',
        "class Left(Root):",
        "    value = 41",
        "    def chain(self):",
        '        return "L" + super().chain()',
        "class Right(Root):",
        "    value = 99",
        "    def chain(self):",
        '        return "T" + super().chain()',
        "class Diamond(Left, Right):",
        "    def __new__(cls):",
        "        item = super().__new__(cls)",
        "        item.created = 42",
        "        return item",
        "    def __init__(self):",
        "        super().__init__()",
        "    def chain(self):",
        '        return "D" + super().chain()',
        "item = Diamond()",
        "print(item.value)",
        "print(Diamond.__bases__[1].__name__)",
        "print(Diamond.__mro__[3].__name__)",
        "print(isinstance(item, Right) and issubclass(Diamond, Left))",
        "print(item.chain())",
        "print(super(Left, item).__self_class__ is Diamond)",
        "print(item.created)",
        "class Redirect:",
        "    def __new__(cls):",
        "        return 43",
        "print(Redirect())",
        "",
      ].join("\n"),
    );

    const result = runtime.executeDebugShellCommand(
      record.computerId,
      "python /tmp/mro.py",
    );

    expect(result).toMatchObject({ exitCode: 0, outcome: "completed" });
    if (result.outcome === "completed") {
      expect(
        result.stdout
          .split("\n")
          .map((line) => line.trimEnd())
          .join("\n"),
      ).toBe("41\nRight\nRoot\nTrue\nDLTR\nTrue\n42\n43\n");
    }
    expect(runtime.guestMemoryStatus(record.computerId)?.usedBytes).toBe(
      baseline,
    );
  });

  it("schedules MCP Python work and completes it from later ticks", (): void => {
    const record = computer(
      "c-000020",
      "import os\nos.pull_event()\n",
      8 * 1_024 * 1_024,
    );
    const runtime = runtimeWith(record);
    runtime.powerOn(record.computerId);
    completeBootCycle(runtime, record);
    record.filesystem.writeFile("/tmp/deferred.py", "print(21 * 2)\n");
    let completion: DebugShellCommandCompletion | undefined;

    runtime.enqueueDebugShellCommand(
      record.computerId,
      "python /tmp/deferred.py",
      (result) => {
        completion = result;
      },
    );

    expect(completion).toBeUndefined();
    runTicks(runtime, 4);
    expect(completion).toMatchObject({
      outcome: "completed",
      exitCode: 0,
      stdout: "42\n",
    });
  });

  it("runs bounded inline Python through the MCP debug path", (): void => {
    const record = computer(
      "c-000018",
      "import os\nos.pull_event()\n",
      8 * 1_024 * 1_024,
    );
    const runtime = runtimeWith(record);
    runtime.powerOn(record.computerId);
    completeBootCycle(runtime, record);

    const result = runtime.executeDebugShellCommand(
      record.computerId,
      "python -c total = 0\nfor i in range(1, 101):\n    total = total + i\nprint(total)",
    );

    expect(result).toMatchObject({
      outcome: "completed",
      exitCode: 0,
      stdout: "5050\n",
    });
    if (result.outcome !== "completed") return;
    expect(result.stderr).toMatch(
      /^Python\/CS486DX: 1536 machine instructions, \d+ CPU cycles,/u,
    );
    expect(result.cpuCycles).toBeGreaterThan(0);
    expect(record.filesystem.exists("/tmp/__mcp_inline__.py")).toBe(false);
  });

  it("runs and measures Python from the normal CS-Linux terminal", (): void => {
    const record = new ComputerRecord("c-000010", "advanced");
    record.configureHardware(advancedComputerHardware);
    const runtime = runtimeWith(record);
    runtime.powerOn(record.computerId);
    record.filesystem.writeFile(
      "/tmp/sum.py",
      [
        "total = 0",
        "for i in range(1, 101):",
        "    total = total + i",
        "print(total)",
      ].join("\n"),
    );
    completeBootCycle(runtime, record);

    runtime.queueEvent(
      record.computerId,
      "terminal_line",
      "python --stats /tmp/sum.py",
    );
    runTicks(runtime, 12);

    const output = record.terminal.snapshot().rows.join("\n");
    expect(output).toContain("5050");
    expect(output).toMatch(
      /Python\/CS486DX2: \d+ machine instructions, \d+ CPU cycles, \d+\.\d{3} us at 66 M\s*Hz, completed/u,
    );
    expect(output).toContain("cs@c-000010:~$ ");
    expect(runtime.vmState(record.computerId)).toMatchObject({
      kind: "waiting_event",
    });
    expect(record.lifecycle.state.kind).not.toBe("off");
  });

  it("interrupts foreground Python without powering off the shell", (): void => {
    const record = new ComputerRecord("c-000011", "standard");
    const runtime = runtimeWith(record);
    runtime.powerOn(record.computerId);
    record.filesystem.writeFile("/tmp/loop.py", "while True:\n    pass\n");
    completeBootCycle(runtime, record);
    runtime.queueEvent(
      record.computerId,
      "terminal_line",
      "python --stats /tmp/loop.py",
    );
    runTicks(runtime, 2);

    expect(runtime.interrupt(record.computerId)).toMatchObject({
      outcome: "accepted",
      state: "foreground_interrupted",
    });
    runTicks(runtime, 3);

    const output = record.terminal.snapshot().rows.join("\n");
    expect(output).toContain("^C");
    expect(output).toMatch(
      /Python\/CS486DX: \d+ machine instructions, \d+ CPU cycles,[\s\S]*terminated/u,
    );
    expect(output).toContain("cs@c-000011:~$ ");
    expect(record.lifecycle.state.kind).not.toBe("off");
  });

  it("schedules normal run commands in bounded instruction slices", (): void => {
    const record = new ComputerRecord("c-000019", "standard");
    const runtime = new ComputerRuntime({
      schedulerLimits: {
        cpuCyclesPerComputer: 100_000,
        cpuCyclesPerTick: 100_000,
        eventCapacity: 8,
        instructionsPerComputer: 200,
        instructionsPerTick: 200,
        timerCapacity: 8,
      },
    });
    runtime.register(record);
    runtime.powerOn(record.computerId);
    record.filesystem.writeFile(
      "/tmp/loop.asm",
      "start:\nadd eax,1\njmp start\n",
    );
    completeBootCycle(runtime, record);
    expect(
      runtime.executeDebugShellCommand(
        record.computerId,
        "as /tmp/loop.asm -o /tmp/loop",
      ),
    ).toMatchObject({ outcome: "completed", exitCode: 0 });
    runTicks(runtime, 2);

    runtime.queueEvent(record.computerId, "terminal_line", "run /tmp/loop");
    runTicks(runtime, 4);

    expect(runtime.vmState(record.computerId)).toEqual({ kind: "ready" });
    expect(runtime.interrupt(record.computerId)).toMatchObject({
      outcome: "accepted",
      state: "foreground_interrupted",
    });
    runTicks(runtime, 3);
    expect(record.terminal.snapshot().rows.join("\n")).toContain("^C");
    expect(runtime.vmState(record.computerId)).toMatchObject({
      kind: "waiting_event",
    });
  });

  it("routes events to waiting foreground Python and then restores the shell", (): void => {
    const record = new ComputerRecord("c-000012", "standard");
    const runtime = runtimeWith(record);
    runtime.powerOn(record.computerId);
    record.filesystem.writeFile(
      "/tmp/event.py",
      'import os\nos.pull_event("custom")\nprint(42)\n',
    );
    completeBootCycle(runtime, record);

    runtime.queueEvent(
      record.computerId,
      "terminal_line",
      "python /tmp/event.py",
    );
    runTicks(runtime, 2);
    expect(runtime.vmState(record.computerId)).toEqual({
      kind: "waiting_event",
      filter: "custom",
    });

    runtime.queueEvent(record.computerId, "mouse", 1);
    runTicks(runtime, 1);
    expect(runtime.vmState(record.computerId)).toEqual({
      kind: "waiting_event",
      filter: "custom",
    });
    runtime.queueEvent(record.computerId, "custom", 9);
    runTicks(runtime, 3);

    const output = record.terminal.snapshot().rows.join("\n");
    expect(output).toContain("42");
    expect(output).toContain("cs@c-000012:~$ ");
    expect(runtime.vmState(record.computerId)).toMatchObject({
      kind: "waiting_event",
    });
  });

  it("reports foreground Python compile failures and keeps the shell usable", (): void => {
    const record = new ComputerRecord("c-000013", "standard");
    const runtime = runtimeWith(record);
    runtime.powerOn(record.computerId);
    record.filesystem.writeFile("/tmp/broken.py", "if True print(42)\n");
    completeBootCycle(runtime, record);

    runtime.queueEvent(
      record.computerId,
      "terminal_line",
      "python /tmp/broken.py",
    );
    runTicks(runtime, 3);

    const output = record.terminal.snapshot().rows.join("\n");
    expect(output).toContain("python:");
    expect(output).toContain("cs@c-000013:~$ ");
    expect(record.lifecycle.state.kind).not.toBe("off");
  });

  it("reports comparable CPU cycles across ASM, C++, and Python/CS486DX", (): void => {
    const record = computer(
      "c-000002",
      "import os\nos.pull_event()\n",
      8 * 1_024 * 1_024,
    );
    const runtime = runtimeWith(record);
    runtime.powerOn(record.computerId);
    record.filesystem.writeFile(
      "/tmp/answer.asm",
      "mov eax,6\nmul eax,7\nprint eax\nhalt\n",
    );
    record.filesystem.writeFile(
      "/tmp/answer.cpp",
      [
        "int main(){",
        "int answer=6*7;",
        "std::cout<<answer<<std::endl;",
        "return 0;",
        "}",
      ].join("\n"),
    );
    record.filesystem.writeFile("/tmp/answer.py", "print(6 * 7)\n");
    completeBootCycle(runtime, record);

    expect(
      runtime.executeDebugShellCommand(
        record.computerId,
        "as /tmp/answer.asm -o /tmp/answer-asm",
      ),
    ).toMatchObject({ outcome: "completed", exitCode: 0 });
    expect(
      runtime.executeDebugShellCommand(
        record.computerId,
        "c++ /tmp/answer.cpp -o /tmp/answer-cpp",
      ),
    ).toMatchObject({ outcome: "completed", exitCode: 0 });
    const asm = runtime.executeDebugShellCommand(
      record.computerId,
      "run --stats /tmp/answer-asm",
    );
    const cpp = runtime.executeDebugShellCommand(
      record.computerId,
      "run --stats /tmp/answer-cpp",
    );
    const python = runtime.executeDebugShellCommand(
      record.computerId,
      "python /tmp/answer.py",
    );

    expect(asm).toMatchObject({ outcome: "completed", stdout: "42" });
    expect(cpp).toMatchObject({ outcome: "completed", stdout: "42\n" });
    expect(python).toMatchObject({ outcome: "completed", stdout: "42\n" });
    if (
      asm.outcome !== "completed" ||
      cpp.outcome !== "completed" ||
      python.outcome !== "completed"
    )
      return;
    expect(asm.stderr).toMatch(/\d+ CPU cycles/u);
    expect(cpp.stderr).toMatch(/\d+ CPU cycles/u);
    expect(asm.stderr).toContain("L1 3 hit/1 miss");
    expect(cpp.stderr).toMatch(/L1 \d+ hit\/\d+ miss/u);
    expect(python.stderr).toMatch(/\d+ CPU cycles/u);
    expect(asm.cpuCycles).toBeLessThan(cpp.cpuCycles);
    expect(cpp.cpuCycles).toBeLessThan(python.cpuCycles);
  });

  it("preprocesses credentialed guest headers in deferred C compile jobs", (): void => {
    const record = computer("c-000025", "import os\nos.pull_event()\n");
    const runtime = runtimeWith(record);
    runtime.powerOn(record.computerId);
    record.filesystem.makeDirectory("/tmp/inc");
    record.filesystem.writeFile("/tmp/inc/value.h", "#define HEADER_VALUE 2\n");
    record.filesystem.writeFile(
      "/tmp/preprocess.c",
      [
        "#include <stdio.h>",
        "#include <value.h>",
        "int main(){",
        'printf("%d\\n", BASE_VALUE + HEADER_VALUE);',
        "return 0;",
        "}",
        "",
      ].join("\n"),
    );
    completeBootCycle(runtime, record);

    const compiled = runtime.executeDebugShellCommand(
      record.computerId,
      "cc -I /tmp/inc -D BASE_VALUE=40 /tmp/preprocess.c -o /tmp/preprocess",
    );
    expect(
      compiled,
      compiled.outcome === "completed"
        ? compiled.stderr
        : JSON.stringify(compiled),
    ).toMatchObject({ outcome: "completed", exitCode: 0 });
    expect(
      runtime.executeDebugShellCommand(
        record.computerId,
        "run /tmp/preprocess",
      ),
    ).toMatchObject({ outcome: "completed", exitCode: 0, stdout: "42\n" });

    record.filesystem.setMetadata("/tmp/inc/value.h", {
      gid: 0,
      mode: 0,
      uid: 0,
    });
    const denied = runtime.executeDebugShellCommand(
      record.computerId,
      "cc -I /tmp/inc /tmp/preprocess.c -o /tmp/denied",
    );
    expect(denied).toMatchObject({ outcome: "completed", exitCode: 1 });
    if (denied.outcome === "completed") {
      expect(denied.stderr).toContain("include file is not readable");
    }
    expect(record.filesystem.exists("/tmp/denied")).toBe(false);
  });

  it("imports a C object from Python through the MCP debug path", (): void => {
    const record = computer(
      "c-000003",
      "import os\nos.pull_event()\n",
      8 * 1_024 * 1_024,
    );
    const runtime = runtimeWith(record);
    runtime.powerOn(record.computerId);
    record.filesystem.writeFile(
      "/tmp/fastmath.c",
      "int answer(){\nreturn 42;\n}\n",
    );
    record.filesystem.writeFile(
      "/tmp/use_fastmath.py",
      "import fastmath\nprint(fastmath.answer())\n",
    );
    completeBootCycle(runtime, record);

    expect(
      runtime.executeDebugShellCommand(
        record.computerId,
        "cc -c /tmp/fastmath.c -o /tmp/fastmath.o",
      ),
    ).toMatchObject({ outcome: "completed", exitCode: 0 });
    const result = runtime.executeDebugShellCommand(
      record.computerId,
      "python /tmp/use_fastmath.py",
    );

    expect(result).toMatchObject({
      outcome: "completed",
      exitCode: 0,
      stdout: "42\n",
    });
    if (result.outcome === "completed") {
      expect(result.stderr).toMatch(/^Python\/CS486DX:/u);
      expect(result.cpuCycles).toBeGreaterThan(0);
    }
  });

  it("rejects user MicroPython on portable CS386SX and ignores startup.py", (): void => {
    const record = new ComputerRecord("c-000104", "advanced", {
      hardware: portableComputerHardware,
      osProfile: "dos",
    });
    record.filesystem.writeFile("/startup.py", "this is not valid Python\n");
    const runtime = runtimeWith(record);
    expect(runtime.powerOn(record.computerId)).toMatchObject({
      outcome: "accepted",
      state: "booting",
    });
    completeBootCycle(runtime, record);
    record.filesystem.writeFile("/drives/c/demo.py", "print(6 * 7)\n");

    const result = runtime.executeDebugShellCommand(
      record.computerId,
      "python /drives/c/demo.py",
    );
    expect(result).toMatchObject({
      outcome: "completed",
      exitCode: 127,
      stdout: "",
    });
    if (result.outcome === "completed") {
      expect(result.stderr).toBe("MicroPython is not available on CS386SX\n");
    }
  });

  it("yields infinite work and synchronizes sleep and event waits", (): void => {
    const record = computer(
      "computer-2",
      'import os\nos.sleep(0.1)\nevent = os.pull_event("key")\nwhile True:\n    pass\n',
    );
    const runtime = runtimeWith(record);
    runtime.powerOn(record.computerId);
    completeBootCycle(runtime, record);
    expect(record.lifecycle.state.kind).toBe("sleeping");
    runtime.runTick();
    runtime.runTick();
    expect(record.lifecycle.state).toEqual({
      kind: "waiting_event",
      filter: "key",
    });
    expect(runtime.queueEvent(record.computerId, "mouse", 1).outcome).toBe(
      "accepted",
    );
    expect(runtime.queueEvent(record.computerId, "key", 42).outcome).toBe(
      "accepted",
    );
    runtime.runTick();
    expect(record.lifecycle.state.kind).toBe("running");
    expect(runtime.vmState(record.computerId)?.kind).toBe("ready");
  });

  it("finalizes shutdown, terminate, and reboot exactly once", (): void => {
    const shutdown = computer("computer-3", "import os\nos.shutdown()\n");
    const shutdownRuntime = runtimeWith(shutdown);
    shutdownRuntime.powerOn(shutdown.computerId);
    completeBootCycle(shutdownRuntime, shutdown);
    runTicks(shutdownRuntime, 12);
    expect(shutdown.lifecycle.state).toEqual({ kind: "off" });
    expect(shutdownRuntime.shutdown(shutdown.computerId)).toMatchObject({
      outcome: "ignored",
    });

    const terminated = computer("computer-4", "while True:\n    pass\n");
    const terminateRuntime = runtimeWith(terminated);
    terminateRuntime.powerOn(terminated.computerId);
    terminateRuntime.runTick();
    expect(terminateRuntime.terminate(terminated.computerId)).toMatchObject({
      outcome: "accepted",
      state: "stopping",
    });
    runTicks(terminateRuntime, 12);
    expect(terminated.lifecycle.state).toEqual({ kind: "off" });

    const rebooted = computer(
      "computer-5",
      'import os\nprint("boot")\nos.pull_event("reboot")\nos.reboot()\n',
    );
    const rebootRuntime = runtimeWith(rebooted);
    rebootRuntime.powerOn(rebooted.computerId);
    completeBootCycle(rebootRuntime, rebooted);
    rebootRuntime.queueEvent(rebooted.computerId, "reboot");
    expect(completeBootCycle(rebootRuntime, rebooted)).toBeGreaterThan(70);
    expect(rebooted.lifecycle.state.kind).toBe("waiting_event");
    expect(rebooted.display.state.kind).toBe("text");
    expect(
      rebooted.terminal.snapshot().rows.filter((line) => /^boot/u.test(line)),
    ).toHaveLength(1);
  });

  it("does not finalize a terminal VM until its CPU cycle debt is paid", (): void => {
    const record = new ComputerRecord("computer-16", "standard", {
      hardware: {
        clockHz: 1,
        cpuModel: "cs486dx",
        memoryBytes: 1_048_576,
      },
    });
    record.filesystem.writeFile("/startup.py", "pass\n");
    const runtime = new ComputerRuntime({
      schedulerLimits: {
        eventCapacity: 8,
        timerCapacity: 8,
        cpuCyclesPerComputer: 1_000,
        cpuCyclesPerTick: 1_000,
      },
    });
    runtime.register(record);
    configureInMemoryPersistence(runtime, record);
    runtime.powerOn(record.computerId);

    completeBootCycle(runtime, record);
    expect(record.lifecycle.state.kind).toBe("running");
    runTicks(runtime, 1_000);
    expect(record.lifecycle.state).toEqual({ kind: "off" });
  });

  it("reports syntax and runtime crashes without leaving scheduled work", (): void => {
    const syntax = computer("computer-6", "if True\n    pass\n");
    const syntaxRuntime = runtimeWith(syntax);
    expect(syntaxRuntime.powerOn(syntax.computerId).outcome).toBe("failed");
    expect(syntax.lifecycle.state.kind).toBe("crashed");

    const fault = computer("computer-7", "missing_name\n");
    const faultRuntime = runtimeWith(fault);
    faultRuntime.powerOn(fault.computerId);
    completeBootCycle(faultRuntime, fault);
    expect(fault.lifecycle.state.kind).toBe("crashed");
    if (fault.lifecycle.state.kind === "crashed") {
      expect(fault.lifecycle.state.message).toMatch(/not defined/u);
    }
    expect(faultRuntime.vmState(fault.computerId)).toBeUndefined();
  });
});

function computer(
  id: string,
  startup: string,
  memoryBytes = 2 * 1_024 * 1_024,
): ComputerRecord {
  const record = new ComputerRecord(id, "standard");
  if (record.hardware.memoryBytes !== memoryBytes) {
    record.configureHardware({ ...record.hardware, memoryBytes });
  }
  record.filesystem.writeFile("/startup.py", startup);
  return record;
}

function runtimeWith(record: ComputerRecord): ComputerRuntime {
  const runtime = new ComputerRuntime({
    schedulerLimits: {
      eventCapacity: 8,
      timerCapacity: 8,
      cpuCyclesPerComputer: 100_000,
      cpuCyclesPerTick: 100_000,
    },
  });
  runtime.register(record);
  configureInMemoryPersistence(runtime, record);
  return runtime;
}

function configureInMemoryPersistence(
  runtime: ComputerRuntime,
  record: ComputerRecord,
): void {
  let generation = 0;
  const snapshots = new Map<string, ComputerSnapshot>();
  runtime.configureLifecycleBoundaries({
    pendingFilesystemIo: (): number => 0,
    stopDevices: (): void => undefined,
    syncPersistence: (computerId) => {
      if (computerId !== record.computerId) {
        return { outcome: "missing" as const, computerId };
      }
      snapshots.set(computerId, structuredClone(record.snapshot()));
      generation += 1;
      return { outcome: "saved" as const, generation };
    },
  });
}

function runTicks(runtime: ComputerRuntime, count: number): void {
  for (let tick = 0; tick < count; tick += 1) runtime.runTick();
}

function completeBootCycle(
  runtime: ComputerRuntime,
  record: ComputerRecord,
  maximumTicks = 200,
): number {
  let observedPost = false;
  for (let tick = 0; tick <= maximumTicks; tick += 1) {
    if (
      record.lifecycle.state.kind === "booting" &&
      record.display.state.kind === "post"
    ) {
      observedPost = true;
    }
    if (
      observedPost &&
      record.lifecycle.state.kind !== "booting" &&
      record.display.state.kind !== "post"
    ) {
      return tick;
    }
    if (tick < maximumTicks) runtime.runTick();
  }
  throw new Error(
    `Computer ${record.computerId} did not complete a POST cycle within ${String(maximumTicks)} ticks`,
  );
}
