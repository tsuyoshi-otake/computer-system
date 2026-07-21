import { describe, expect, it } from "vitest";

import { ComputerRuntime } from "../../src/application/computer/computerRuntime.js";
import { compileCs486Source } from "../../src/application/toolchain/highLevelCompilers.js";
import { ComputerRecord } from "../../src/domain/computer/computer.js";

describe("ComputerRuntime CS ABI ownership", (): void => {
  it("launches Linux run with argc/argv and publishes main return once", (): void => {
    const runtime = new ComputerRuntime();
    const record = new ComputerRecord("c-006301", "standard");
    runtime.register(record);
    runtime.powerOn(record.computerId);
    completeBoot(runtime, record);
    const executable = compileCs486Source(
      "c",
      "int main(int argc, char **argv){return argc;}\n",
    );
    record.filesystem.writeFile(
      "/tmp/argc",
      `CS486\n${JSON.stringify(executable)}`,
    );
    record.filesystem.setMetadata("/tmp/argc", { mode: 0o755 });
    const baseline = runtime.guestMemoryStatus(record.computerId);
    expect(
      runtime.queueEvent(
        record.computerId,
        "terminal_line",
        'run /tmp/argc one "two words"',
      ),
    ).toMatchObject({ outcome: "accepted" });
    for (
      let tick = 0;
      tick < 20 &&
      runtime.terminalInteraction(record.computerId).context !== "cs-abi";
      tick += 1
    ) {
      runtime.runTick();
    }
    expect(runtime.terminalInteraction(record.computerId)).toMatchObject({
      context: "cs-abi",
      inputMode: "keys",
      interrupt: true,
    });
    expect(
      runtime.guestMemoryStatus(record.computerId)?.usedBytes,
    ).toBeGreaterThan(baseline!.usedBytes);

    for (
      let tick = 0;
      tick < 20 &&
      runtime.terminalInteraction(record.computerId).context === "cs-abi";
      tick += 1
    ) {
      runtime.runTick();
    }
    expect(
      runtime.executeDebugShellCommand(record.computerId, "echo $?"),
    ).toMatchObject({ outcome: "completed", stdout: "3\n" });
    expect(runtime.guestMemoryStatus(record.computerId)).toEqual(baseline);
    runtime.runTick();
  });

  it("rejects startup capacity plus one without retaining process RAM", (): void => {
    const runtime = new ComputerRuntime();
    const record = new ComputerRecord("c-006302", "standard");
    runtime.register(record);
    runtime.powerOn(record.computerId);
    completeBoot(runtime, record);
    const executable = compileCs486Source("c", "int main(){return 0;}\n");
    record.filesystem.writeFile(
      "/tmp/cap",
      `CS486\n${JSON.stringify(executable)}`,
    );
    record.filesystem.setMetadata("/tmp/cap", { mode: 0o755 });
    const baseline = runtime.guestMemoryStatus(record.computerId);
    const arguments_ = Array.from({ length: 64 }, () => "x").join(" ");

    expect(
      runtime.queueEvent(
        record.computerId,
        "terminal_line",
        `run /tmp/cap ${arguments_}`,
      ),
    ).toMatchObject({ outcome: "accepted" });
    for (let tick = 0; tick < 20; tick += 1) runtime.runTick();

    expect(
      runtime.executeDebugShellCommand(record.computerId, "echo $?"),
    ).toMatchObject({ outcome: "completed", stdout: "1\n" });
    expect(runtime.guestMemoryStatus(record.computerId)).toEqual(baseline);
    expect(runtime.terminalInteraction(record.computerId).context).not.toBe(
      "cs-abi",
    );
  });

  it("resolves a hosted executable by guest PATH and uses its exact path as argv0", (): void => {
    const runtime = new ComputerRuntime();
    const record = new ComputerRecord("c-006305", "standard");
    runtime.register(record);
    runtime.powerOn(record.computerId);
    completeBoot(runtime, record);
    if (!record.filesystem.exists("/usr/games"))
      record.filesystem.makeDirectory("/usr/games");
    const executable = compileCs486Source(
      "c",
      "int equal(char *a, char *b){int i=0; while(a[i]==b[i] && a[i]!=0){i=i+1;} return a[i]==b[i];}\n" +
        'int main(int argc, char **argv){if(argc != 2) return 20; if(!equal(argv[0], "/usr/games/demo")) return 21; if(!equal(argv[1], "argument")) return 22; return 0;}\n',
    );
    record.filesystem.writeFile(
      "/usr/games/demo",
      `CS486\n${JSON.stringify(executable)}`,
    );
    record.filesystem.setMetadata("/usr/games/demo", {
      gid: 0,
      mode: 0o755,
      uid: 0,
    });

    expect(
      runtime.queueEvent(record.computerId, "terminal_line", "demo argument"),
    ).toMatchObject({ outcome: "accepted" });
    for (let tick = 0; tick < 40; tick += 1) runtime.runTick();
    expect(
      runtime.executeDebugShellCommand(record.computerId, "echo $?"),
    ).toMatchObject({ outcome: "completed", stdout: "0\n" });
  });

  it("applies launch credentials to hosted filesystem syscalls", (): void => {
    const runtime = new ComputerRuntime();
    const record = new ComputerRecord("c-006307", "standard");
    runtime.register(record);
    runtime.powerOn(record.computerId);
    completeBoot(runtime, record);
    record.filesystem.writeFile("/root/hosted-secret", "secret");
    record.filesystem.setMetadata("/root/hosted-secret", {
      gid: 0,
      mode: 0o600,
      uid: 0,
    });
    const executable = compileCs486Source(
      "c",
      "int __cs_syscall(int selector, int a0, int a1, int a2);\n" +
        'char *path = "/root/hosted-secret";\n' +
        "int main(){int result=__cs_syscall(8,(int)path,1,0); return result == -13 ? 0 : 9;}\n",
    );
    record.filesystem.writeFile(
      "/tmp/dac-check",
      `CS486\n${JSON.stringify(executable)}`,
    );
    record.filesystem.setMetadata("/tmp/dac-check", { mode: 0o755 });

    expect(
      runtime.queueEvent(
        record.computerId,
        "terminal_line",
        "run /tmp/dac-check",
      ),
    ).toMatchObject({ outcome: "accepted" });
    for (let tick = 0; tick < 60; tick += 1) runtime.runTick();
    expect(
      runtime.executeDebugShellCommand(record.computerId, "echo $?"),
    ).toMatchObject({ outcome: "completed", stdout: "0\n" });
    expect(record.filesystem.readFile("/root/hosted-secret")).toBe("secret");
  });

  it.each(["interrupt", "terminal-close"] as const)(
    "finalizes a blocked key wait exactly once on %s",
    (ending): void => {
      const runtime = new ComputerRuntime();
      const record = new ComputerRecord(
        ending === "interrupt" ? "c-006303" : "c-006304",
        "standard",
      );
      runtime.register(record);
      runtime.powerOn(record.computerId);
      completeBoot(runtime, record);
      const executable = compileCs486Source(
        "c",
        "int __cs_syscall(int selector, int a0, int a1, int a2);\n" +
          "int main(){return __cs_syscall(3, 0, 0, 0);}\n",
      );
      record.filesystem.writeFile(
        "/tmp/wait-key",
        `CS486\n${JSON.stringify(executable)}`,
      );
      record.filesystem.setMetadata("/tmp/wait-key", { mode: 0o755 });
      const baseline = runtime.guestMemoryStatus(record.computerId);
      runtime.queueEvent(
        record.computerId,
        "terminal_line",
        "run /tmp/wait-key",
      );
      for (
        let tick = 0;
        tick < 30 &&
        runtime.terminalInteraction(record.computerId).context !== "cs-abi";
        tick += 1
      )
        runtime.runTick();
      runtime.runTick();
      expect(
        runtime.guestMemoryStatus(record.computerId)!.usedBytes,
      ).toBeGreaterThan(baseline!.usedBytes);

      const result =
        ending === "interrupt"
          ? runtime.interrupt(record.computerId)
          : runtime.queueEvent(record.computerId, "terminal_closed");
      expect(result.outcome).toBe("accepted");
      for (let tick = 0; tick < 3; tick += 1) runtime.runTick();
      expect(runtime.guestMemoryStatus(record.computerId)).toEqual(baseline);
      expect(runtime.terminalInteraction(record.computerId).context).not.toBe(
        "cs-abi",
      );
      runtime.runTick();
      expect(runtime.guestMemoryStatus(record.computerId)).toEqual(baseline);
    },
  );

  it("releases a blocked hosted process exactly once during runtime termination", (): void => {
    const runtime = new ComputerRuntime();
    runtime.configureLifecycleBoundaries({
      pendingFilesystemIo: (): number => 0,
      stopDevices: (): void => {},
      syncPersistence: () => ({ outcome: "unchanged" }),
    });
    const record = new ComputerRecord("c-006308", "standard");
    runtime.register(record);
    runtime.powerOn(record.computerId);
    completeBoot(runtime, record);
    const executable = compileCs486Source(
      "c",
      "int __cs_syscall(int selector, int a0, int a1, int a2);\n" +
        "int main(){return __cs_syscall(3, 0, 0, 0);}\n",
    );
    record.filesystem.writeFile(
      "/tmp/wait-terminate",
      `CS486\n${JSON.stringify(executable)}`,
    );
    record.filesystem.setMetadata("/tmp/wait-terminate", { mode: 0o755 });
    runtime.queueEvent(
      record.computerId,
      "terminal_line",
      "run /tmp/wait-terminate",
    );
    for (
      let tick = 0;
      tick < 30 &&
      runtime.terminalInteraction(record.computerId).context !== "cs-abi";
      tick += 1
    )
      runtime.runTick();
    runtime.runTick();
    expect(runtime.terminalInteraction(record.computerId).context).toBe(
      "cs-abi",
    );

    expect(runtime.terminate(record.computerId)).toMatchObject({
      outcome: "accepted",
      state: "stopping",
    });
    for (let tick = 0; tick < 20; tick += 1) runtime.runTick();
    expect(record.lifecycle.state).toEqual({ kind: "off" });
    expect(runtime.guestMemoryStatus(record.computerId)).toBeUndefined();
    const finalized = runtime.guestMemoryStatus(record.computerId);
    runtime.runTick();
    expect(runtime.guestMemoryStatus(record.computerId)).toEqual(finalized);
  });

  it("keeps a key queued before wait from waking the following wait", (): void => {
    const runtime = new ComputerRuntime();
    const record = new ComputerRecord("c-006306", "standard");
    runtime.register(record);
    runtime.powerOn(record.computerId);
    completeBoot(runtime, record);
    const executable = compileCs486Source(
      "c",
      "int __cs_syscall(int selector, int a0, int a1, int a2);\n" +
        "int main(){int first=__cs_syscall(3,0,0,0); int second=__cs_syscall(3,0,0,0); return first==83 && second==113 ? 0 : 9;}\n",
    );
    record.filesystem.writeFile(
      "/tmp/two-keys",
      `CS486\n${JSON.stringify(executable)}`,
    );
    record.filesystem.setMetadata("/tmp/two-keys", { mode: 0o755 });

    runtime.queueEvent(record.computerId, "terminal_line", "run /tmp/two-keys");
    for (
      let tick = 0;
      tick < 30 &&
      runtime.terminalInteraction(record.computerId).context !== "cs-abi";
      tick += 1
    )
      runtime.runTick();
    expect(
      runtime.queueEvent(record.computerId, "terminal_keys", '["S"]'),
    ).toMatchObject({ outcome: "accepted" });
    for (let tick = 0; tick < 100; tick += 1) runtime.runTick();
    expect(runtime.terminalInteraction(record.computerId).context).toBe(
      "cs-abi",
    );

    expect(
      runtime.queueEvent(record.computerId, "terminal_keys", '["q"]'),
    ).toMatchObject({ outcome: "accepted" });
    for (
      let tick = 0;
      tick < 100 &&
      runtime.terminalInteraction(record.computerId).context === "cs-abi";
      tick += 1
    )
      runtime.runTick();
    expect(
      runtime.executeDebugShellCommand(record.computerId, "echo $?"),
    ).toMatchObject({ outcome: "completed", stdout: "0\n" });
  });
});

function completeBoot(runtime: ComputerRuntime, record: ComputerRecord): void {
  for (let tick = 0; tick < 200; tick += 1) {
    if (
      record.lifecycle.state.kind !== "booting" &&
      record.display.state.kind !== "post"
    ) {
      return;
    }
    runtime.runTick();
  }
  throw new Error("runtime did not complete CSBIOS");
}
