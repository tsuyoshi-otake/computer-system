import { describe, expect, it } from "vitest";
import { ComputerRuntime } from "../../src/application/computer/computerRuntime.js";
import {
  ComputerRecord,
  type ComputerSnapshot,
} from "../../src/domain/computer/computer.js";
import { ShellSession } from "../../src/application/os/shellSession.js";

describe("default Computer System Linux boot", (): void => {
  it("clears the persisted display before rendering one boot banner", (): void => {
    const record = new ComputerRecord("computer-29", "standard");
    record.terminal.write("stale boot banner");
    const runtime = new ComputerRuntime({ requireLinuxLogin: true });
    runtime.register(record);

    expect(runtime.powerOn(record.computerId).outcome).toBe("accepted");
    expect(record.terminal.width).toBe(80);
    expect(record.terminal.height).toBe(25);
    expect(
      record.terminal.snapshot().rows.every((line) => line.trim() === ""),
    ).toBe(true);
    expect(record.lifecycle.state.kind).toBe("booting");
    expect(record.display.state).toEqual({
      kind: "post",
      modeId: "text-80x25",
    });
    expect(
      runtime.queueEvent(record.computerId, "terminal_line", "ignored"),
    ).toEqual({ outcome: "ignored", reason: "not_running" });
    completeBoot(runtime, record);

    const screen = record.terminal.snapshot().rows.join("\n");
    expect(screen).not.toContain("stale boot banner");
    expect(screen.match(/Computer System Linux 1\.0/gu)).toHaveLength(1);
    expect(record.terminal.line(1).trimEnd()).toBe("Computer System Linux 1.0");
    expect(record.terminal.line(2).trimEnd()).toBe("");
    expect(record.terminal.line(3).trimEnd()).toBe("CS-Linux 1.0 console tty1");
    expect(record.terminal.line(4).trimEnd()).toBe("New password:");
    expect(screen).not.toContain("Computer System Bash");
    expect(screen).not.toContain("CS-Linux first boot:");
    expect(screen).not.toContain("login required");
    expect(screen.match(/New password:/gu)).toHaveLength(1);
    expect(screen).not.toContain("CSBIOS System Configuration");
    expect(record.display.state).toEqual({
      kind: "text",
      modeId: "text-80x25",
    });
  });

  it("hands a Portable CSBIOS POST to CS-DOS without tty1 or Bash", (): void => {
    const record = new ComputerRecord("computer-33", "advanced", {
      displayProfileId: "portable-vga-256k",
      hardware: {
        clockHz: 16_000_000,
        cpuModel: "cs386sx",
        memoryBytes: 2_097_152,
      },
      osProfile: "dos",
    });
    const runtime = new ComputerRuntime();
    runtime.register(record);

    expect(runtime.powerOn(record.computerId).outcome).toBe("accepted");
    runTicks(runtime, 51);
    const post = record.terminal.snapshot().rows.join("\n");
    expect(post).toContain("CSBIOS Revision 1.1");
    expect(post).toContain("CPU            : CS386SX at 16 MHz");
    expect(post).toContain("Video Adapter  : CS-VGA Portable, 256 KB");
    expect(post).toContain("Display        : 800x480 LCD / VGA text 80x25");
    expect(post).toContain("Boot Target    : Computer System DOS 1.0");

    completeBoot(runtime, record);
    const dos = record.terminal.snapshot().rows.join("\n");
    expect(record.terminal.line(1).trimEnd()).toBe("Computer System DOS 1.0");
    expect(record.terminal.line(2).trimEnd()).toBe("");
    expect(record.terminal.line(3).trimEnd()).toBe("C:\\>");
    expect(dos).not.toContain("tty1");
    expect(dos).not.toContain("Bash");
    expect(dos).not.toContain("CSBIOS System Configuration");
    expect(record.display.state).toEqual({
      kind: "text",
      modeId: "text-80x25",
    });
  });

  it("renders ambiguous shell completion inside the authoritative terminal", (): void => {
    const record = new ComputerRecord("computer-34", "standard");
    const runtime = new ComputerRuntime();
    runtime.register(record);
    runtime.powerOn(record.computerId);
    completeBoot(runtime, record);

    expect(runtime.completeShellInput(record.computerId, "who", 3)).toEqual({
      cursor: 3,
      outcome: "listed",
      truncated: false,
      value: "who",
    });
    const listed = record.terminal
      .snapshot()
      .rows.map((row) => row.trimEnd())
      .join("\n");
    expect(listed).toContain("who     whoami");
    expect(listed).toMatch(/\$ who\nwho {5}whoami\n.*\$\s*$/mu);

    const beforeUnique = record.terminal.snapshot();
    expect(runtime.completeShellInput(record.computerId, "cat /et", 7)).toEqual(
      {
        cursor: 9,
        outcome: "applied",
        truncated: false,
        value: "cat /etc/",
      },
    );
    expect(record.terminal.snapshot()).toEqual(beforeUnique);
  });

  it("runs QBASIC asynchronously on CS386SX and returns to its IDE output window", (): void => {
    const record = new ComputerRecord("computer-133", "standard", {
      displayProfileId: "portable-vga-256k",
      hardware: {
        clockHz: 16_000_000,
        cpuModel: "cs386sx",
        memoryBytes: 2_097_152,
      },
      osProfile: "dos",
    });
    const runtime = new ComputerRuntime();
    runtime.register(record);
    runtime.powerOn(record.computerId);
    completeBoot(runtime, record);
    record.filesystem.writeFile(
      "/drives/c/demo.bas",
      "FOR I = 1 TO 6\nTOTAL = TOTAL + I\nNEXT\nPRINT TOTAL * 2\nEND\n",
    );

    runtime.queueEvent(
      record.computerId,
      "terminal_line",
      "QBASIC /RUN C:\\DEMO.BAS",
    );
    for (let tick = 0; tick < 20; tick += 1) runtime.runTick();

    let screen = record.terminal.snapshot().rows.join("\n");
    expect(screen).toContain("File Edit View Search Run Options");
    expect(screen).toMatch(
      /^ {2}File Edit View Search Run Options\s+Help\s*$/mu,
    );
    expect(screen).not.toContain("Make Run Debug");
    expect(screen).toContain("Program finished");
    runtime.queueEvent(
      record.computerId,
      "terminal_keys",
      JSON.stringify(["F4"]),
    );
    runtime.runTick();
    screen = record.terminal.snapshot().rows.join("\n");
    expect(screen).toContain("42");

    runtime.queueEvent(
      record.computerId,
      "terminal_mouse",
      JSON.stringify({ action: "down", button: 0, sequence: 1, x: 4, y: 2 }),
    );
    runtime.runTick();
    expect(record.lifecycle.state.kind).toBe("waiting_event");
  });

  it("persists an asynchronous .CSX build and opens the WorkBench debugger on CS386SX", (): void => {
    const record = new ComputerRecord("computer-134", "standard", {
      displayProfileId: "portable-vga-256k",
      hardware: {
        clockHz: 16_000_000,
        cpuModel: "cs386sx",
        memoryBytes: 2_097_152,
      },
      osProfile: "dos",
    });
    const runtime = new ComputerRuntime();
    runtime.register(record);
    runtime.powerOn(record.computerId);
    completeBoot(runtime, record);
    record.filesystem.writeFile(
      "/drives/c/main.c",
      ["int main() {", 'printf("%d\\n", 42);', "return 0;", "}", ""].join(
        "\r\n",
      ),
    );

    runtime.queueEvent(record.computerId, "terminal_line", "CSCC C:\\MAIN.C");
    for (let tick = 0; tick < 5; tick += 1) runtime.runTick();
    expect(record.lifecycle.state.kind).toBe("waiting_event");
    runtime.queueEvent(
      record.computerId,
      "terminal_keys",
      JSON.stringify(["Enter"]),
    );
    for (let tick = 0; tick < 5; tick += 1) runtime.runTick();
    expect(record.terminal.snapshot().rows.join("\n")).not.toContain(
      "Enter  Continue",
    );
    expect(
      runtime.queueEvent(
        record.computerId,
        "terminal_keys",
        JSON.stringify(["F7"]),
      ),
    ).toMatchObject({ outcome: "accepted" });
    runtime.runTick();
    const compileWait = record.lifecycle.state;
    expect(compileWait.kind).toBe("waiting_event");
    if (compileWait.kind !== "waiting_event") {
      throw new Error("WorkBench build did not enter foreground wait");
    }
    expect(compileWait.filter).toContain("__cs_foreground_complete:compile:");
    expect(record.terminal.snapshot().rows.join("\n")).toContain(
      "CS C/C++ 1.0",
    );
    for (let tick = 0; tick < 19; tick += 1) runtime.runTick();

    expect(
      record.filesystem.exists("/drives/c/main.csx"),
      record.terminal.snapshot().rows.join("\n"),
    ).toBe(true);
    expect(record.terminal.snapshot().rows.join("\n")).toContain(
      "Built C:\\MAIN.CSX",
    );

    runtime.queueEvent(
      record.computerId,
      "terminal_keys",
      JSON.stringify(["F5"]),
    );
    for (let tick = 0; tick < 20; tick += 1) runtime.runTick();
    const debuggerScreen = record.terminal.snapshot().rows.join("\n");
    expect(debuggerScreen).toContain("CS Debugger 1.0");
    expect(debuggerScreen).toContain("EIP=00000000");
  });

  it("schedules Program List Build and Build-and-Run as one deferred owner", (): void => {
    const record = new ComputerRecord("computer-135", "standard", {
      displayProfileId: "portable-vga-256k",
      hardware: {
        clockHz: 16_000_000,
        cpuModel: "cs386sx",
        memoryBytes: 2_097_152,
      },
      osProfile: "dos",
    });
    const runtime = new ComputerRuntime();
    runtime.register(record);
    runtime.powerOn(record.computerId);
    completeBoot(runtime, record);
    record.filesystem.writeFile(
      "/drives/c/main.c",
      ["int main() {", 'printf("%d\\n", 42);', "return 0;", "}", ""].join(
        "\r\n",
      ),
    );
    record.filesystem.writeFile(
      "/drives/c/main.csp",
      [
        "CS PROGRAM LIST 1.0",
        "SOURCE=MAIN.C",
        "OUTPUT=APP.CSX",
        "LISTING=APP.LST",
        "MAP=APP.MAP",
        "",
      ].join("\r\n"),
    );

    runtime.queueEvent(record.computerId, "terminal_line", "PWB C:\\MAIN.C");
    for (let tick = 0; tick < 5; tick += 1) runtime.runTick();
    runtime.queueEvent(
      record.computerId,
      "terminal_keys",
      JSON.stringify(["Enter", "Alt+m", "p", "Enter"]),
    );
    for (let tick = 0; tick < 5; tick += 1) runtime.runTick();
    runtime.queueEvent(
      record.computerId,
      "terminal_keys",
      JSON.stringify(["F7"]),
    );
    runtime.runTick();

    expect(record.filesystem.exists("/drives/c/app.csx")).toBe(false);
    const buildWait = record.lifecycle.state;
    expect(buildWait.kind).toBe("waiting_event");
    if (buildWait.kind !== "waiting_event") {
      throw new Error("Program List build did not enter foreground wait");
    }
    expect(buildWait.filter).toContain("__cs_foreground_complete:compile:");
    for (let tick = 0; tick < 20; tick += 1) runtime.runTick();
    expect(record.filesystem.exists("/drives/c/app.csx")).toBe(true);
    expect(record.filesystem.exists("/drives/c/app.lst")).toBe(true);
    expect(record.filesystem.exists("/drives/c/app.map")).toBe(true);
    expect(record.terminal.snapshot().rows.join("\n")).toContain(
      "Built C:\\APP.CSX",
    );

    runtime.queueEvent(
      record.computerId,
      "terminal_keys",
      JSON.stringify(["Shift+F5"]),
    );
    runtime.runTick();
    const runWait = record.lifecycle.state;
    expect(runWait.kind).toBe("waiting_event");
    if (runWait.kind !== "waiting_event") {
      throw new Error(
        "Program List Build-and-Run did not enter foreground wait",
      );
    }
    expect(runWait.filter).toContain("__cs_foreground_complete:compile:");
    for (let tick = 0; tick < 30; tick += 1) runtime.runTick();
    runtime.queueEvent(
      record.computerId,
      "terminal_keys",
      JSON.stringify(["F4"]),
    );
    runtime.runTick();
    const results = record.terminal.snapshot().rows.join("\n");
    expect(results).toContain("Reused C:\\MAIN.OBJ");
    expect(results).toContain("42");
    expect(record.lifecycle.state.kind).toBe("waiting_event");
  });

  it("shows only the Linux identity, blank line, and username prompt on later boots", (): void => {
    const record = new ComputerRecord("computer-87", "standard");
    const setup = new ShellSession(record.filesystem, {
      osProfile: "linux",
      requireLogin: true,
    });
    setup.submit("correct-horse");
    setup.submit("correct-horse");
    const runtime = new ComputerRuntime({ requireLinuxLogin: true });
    runtime.register(record);

    runtime.powerOn(record.computerId);
    completeBoot(runtime, record);

    expect(record.terminal.line(1).trimEnd()).toBe("Computer System Linux 1.0");
    expect(record.terminal.line(2).trimEnd()).toBe("");
    expect(record.terminal.line(3).trimEnd()).toBe("CS-Linux 1.0 console tty1");
    expect(record.terminal.line(4).trimEnd()).toBe("computer-87 login:");
    const screen = record.terminal.snapshot().rows.join("\n");
    expect(screen).not.toContain("Computer System Bash");
    expect(screen).not.toContain("login required");
  });

  it("does not duplicate the shell prompt when unrelated events arrive after login", (): void => {
    const record = new ComputerRecord("computer-88", "standard");
    const setup = new ShellSession(record.filesystem, {
      osProfile: "linux",
      requireLogin: true,
    });
    setup.submit("correct-horse");
    setup.submit("correct-horse");
    const runtime = new ComputerRuntime({ requireLinuxLogin: true });
    runtime.register(record);
    runtime.powerOn(record.computerId);
    completeBoot(runtime, record);

    runtime.queueEvent(record.computerId, "terminal_line", "cs");
    runtime.runTick();
    expect(record.terminal.line(5).trimEnd()).toBe("Password:");

    runtime.queueEvent(record.computerId, "terminal_line", "correct-horse");
    runtime.runTick();
    expect(record.terminal.line(6).trimEnd()).toBe("Welcome to CS-Linux 1.0.");
    expect(record.terminal.line(7).trimEnd()).toBe(
      "Type 'help' for commands or 'man cs-linux' for the field guide.",
    );
    expect(record.terminal.line(8).trimEnd()).toBe("cs@computer-88:~$");

    runtime.queueEvent(record.computerId, "redstone", "left");
    runtime.runTick();

    const screen = record.terminal.snapshot().rows.join("\n");
    expect(screen.match(/cs@computer-88:~\$ /gu)).toHaveLength(1);
    expect(record.terminal.line(8).trimEnd()).toBe("cs@computer-88:~$");
    expect(record.lifecycle.state).toEqual({
      kind: "waiting_event",
      filter: undefined,
    });
  });

  it("boots the Linux shell, edits startup.py with vi, and remains cooperatively waiting", (): void => {
    const record = new ComputerRecord("computer-30", "standard");
    const runtime = new ComputerRuntime();
    runtime.register(record);
    expect(runtime.powerOn(record.computerId).outcome).toBe("accepted");
    expect(record.filesystem.readFile("/startup.py")).toBe("");
    expect(record.filesystem.getMetadata("/startup.py")).toMatchObject({
      gid: 1_000,
      mode: 0o644,
      uid: 1_000,
    });
    completeBoot(runtime, record);
    expect(record.terminal.line(1).trimEnd()).toBe("Computer System Linux 1.0");
    expect(record.terminal.line(2).trimEnd()).toBe("");
    expect(record.terminal.line(3).trimEnd()).toBe("Welcome to CS-Linux 1.0.");
    expect(record.terminal.line(4).trimEnd()).toBe(
      "Type 'help' for commands or 'man cs-linux' for the field guide.",
    );
    expect(record.terminal.line(5).trimEnd()).toBe("cs@computer-30:~$");
    expect(record.terminal.cell(1, 1).foreground).toBe(0);
    expect(record.terminal.cell(1, 5).foreground).toBe(0);
    expect(record.lifecycle.state).toEqual({
      kind: "waiting_event",
      filter: undefined,
    });
    runtime.queueEvent(record.computerId, "terminal_line", "vi /startup.py");
    runtime.runTick();
    expect(record.terminal.line(record.terminal.height - 1)).toContain(
      "/startup.py",
    );
    runtime.queueEvent(
      record.computerId,
      "terminal_keys",
      JSON.stringify([
        "i",
        ...'print("boot")',
        "Escape",
        ":",
        "w",
        "q",
        "Enter",
      ]),
    );
    runtime.runTick();
    expect(record.filesystem.readFile("/startup.py")).toBe('print("boot")');
    expect(record.lifecycle.state.kind).toBe("waiting_event");
  });

  it("lets the authenticated UID 1000 owner save startup.py and executes it after reboot", (): void => {
    const record = new ComputerRecord("computer-34", "standard");
    const runtime = new ComputerRuntime({ requireLinuxLogin: true });
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
    runtime.register(record);
    expect(runtime.powerOn(record.computerId).outcome).toBe("accepted");
    completeBoot(runtime, record);
    runtime.queueEvent(record.computerId, "terminal_line", "correct-horse");
    runtime.runTick();
    runtime.queueEvent(record.computerId, "terminal_line", "correct-horse");
    runtime.runTick();

    runtime.queueEvent(record.computerId, "terminal_line", "vi /startup.py");
    runtime.runTick();
    runtime.queueEvent(
      record.computerId,
      "terminal_keys",
      JSON.stringify([
        "i",
        ...'print("rebooted")',
        "Escape",
        ":",
        "w",
        "q",
        "Enter",
      ]),
    );
    runtime.runTick();
    expect(record.filesystem.readFile("/startup.py")).toBe('print("rebooted")');

    expect(runtime.reboot(record.computerId).outcome).toBe("accepted");
    completeBoot(runtime, record);

    expect(record.terminal.snapshot().rows.join("\n")).toContain("rebooted");
    expect(record.filesystem.getMetadata("/startup.py")).toMatchObject({
      gid: 1_000,
      mode: 0o644,
      uid: 1_000,
    });
  });

  it("executes a piped BusyBox command delivered as a terminal event", (): void => {
    const record = new ComputerRecord("computer-31", "standard");
    const runtime = new ComputerRuntime();
    const command =
      "printf 'alpha\\nbeta\\nalpha\\n' | grep alpha | wc -l > count";
    runtime.register(record);
    runtime.powerOn(record.computerId);
    completeBoot(runtime, record);

    runtime.queueEvent(record.computerId, "terminal_line", command);
    runtime.runTick();
    runtime.queueEvent(record.computerId, "terminal_line", "cat count");
    runtime.runTick();

    expect(record.filesystem.readFile("/home/cs/count")).toBe("      2\n");
    const rows = record.terminal.snapshot().rows;
    const prompt = "cs@computer-31:~$ ";
    const promptRow = rows.findIndex((row) => row.includes(prompt));
    expect(promptRow).toBeGreaterThanOrEqual(0);
    const promptColumn = rows[promptRow]!.indexOf(prompt) + prompt.length;
    const commandEcho = [
      rows[promptRow]!.slice(promptColumn),
      ...rows.slice(promptRow + 1),
    ]
      .join("")
      .slice(0, command.length);
    expect(commandEcho).toBe(command);
    expect(
      record.terminal.snapshot().rows.some((line) => line.includes("2")),
    ).toBe(true);
    expect(record.lifecycle.state).toEqual({
      kind: "waiting_event",
      filter: undefined,
    });
  });

  it("edits and saves vi content through a bounded terminal key batch", (): void => {
    const record = new ComputerRecord("computer-32", "standard");
    const runtime = new ComputerRuntime();
    runtime.register(record);
    runtime.powerOn(record.computerId);
    completeBoot(runtime, record);

    runtime.queueEvent(record.computerId, "terminal_line", "vi demo.py");
    runtime.runTick();
    expect(record.terminal.line(record.terminal.height - 1)).toContain(
      "/home/cs/demo.py",
    );
    runtime.queueEvent(
      record.computerId,
      "terminal_keys",
      JSON.stringify([
        "i",
        "p",
        "a",
        "s",
        "s",
        "Escape",
        ":",
        "w",
        "q",
        "Enter",
      ]),
    );
    runtime.runTick();

    expect(record.filesystem.readFile("/home/cs/demo.py")).toBe("pass");
    expect(record.lifecycle.state).toEqual({
      kind: "waiting_event",
      filter: undefined,
    });
  });
});

function runTicks(runtime: ComputerRuntime, count: number): void {
  for (let tick = 0; tick < count; tick += 1) runtime.runTick();
}

function completeBoot(
  runtime: ComputerRuntime,
  record: ComputerRecord,
  maximumTicks = 400,
): void {
  let observedBooting = record.lifecycle.state.kind === "booting";
  for (let tick = 0; tick < maximumTicks; tick += 1) {
    if (
      observedBooting &&
      record.lifecycle.state.kind !== "booting" &&
      record.display.state.kind !== "post"
    ) {
      return;
    }
    runtime.runTick();
    observedBooting ||= record.lifecycle.state.kind === "booting";
  }
  throw new Error(
    `Computer ${record.computerId} did not complete CSBIOS within ${String(maximumTicks)} ticks`,
  );
}
