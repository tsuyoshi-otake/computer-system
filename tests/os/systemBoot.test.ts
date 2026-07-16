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
    expect(record.terminal.line(2)).toContain("CSBIOS System Configuration");
    expect(record.display.state).toEqual({
      kind: "post",
      modeId: "text-80x25",
    });
    runtime.runTick();

    const screen = record.terminal.snapshot().rows.join("\n");
    expect(screen).not.toContain("stale boot banner");
    expect(screen.match(/Computer System Linux 1\.0/gu)).toHaveLength(1);
    expect(record.terminal.line(1).trimEnd()).toBe("Computer System Linux 1.0");
    expect(record.terminal.line(2).trimEnd()).toBe("");
    expect(record.terminal.line(3).trimEnd()).toBe("New password:");
    expect(screen).not.toContain("tty1");
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
    const post = record.terminal.snapshot().rows.join("\n");
    expect(post).toContain("Main Processor : CS386SX");
    expect(post).toContain("Video Memory     : 256 KB");
    expect(post).toContain("Display Panel    : 800x480 LCD");
    expect(post).toContain("Starting Computer System DOS 6.2");

    runtime.runTick();
    const dos = record.terminal.snapshot().rows.join("\n");
    expect(record.terminal.line(1).trimEnd()).toBe("Computer System DOS 6.2");
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
    runtime.runTick();
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
    expect(screen).toContain("File  Edit  View  Search  Run  Debug");
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
    runtime.runTick();

    expect(record.terminal.line(1).trimEnd()).toBe("Computer System Linux 1.0");
    expect(record.terminal.line(2).trimEnd()).toBe("");
    expect(record.terminal.line(3).trimEnd()).toBe("login:");
    const screen = record.terminal.snapshot().rows.join("\n");
    expect(screen).not.toContain("tty1");
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
    runtime.runTick();

    runtime.queueEvent(record.computerId, "terminal_line", "cs");
    runtime.runTick();
    expect(record.terminal.line(4).trimEnd()).toBe("Password:");

    runtime.queueEvent(record.computerId, "terminal_line", "correct-horse");
    runtime.runTick();
    expect(record.terminal.line(5).trimEnd()).toBe("Login successful.");
    expect(record.terminal.line(6).trimEnd()).toBe(
      "Welcome to CS-Linux 1.0. Type 'help' for commands or 'man cs-linux' for the fiel",
    );
    expect(record.terminal.line(7).trimEnd()).toBe("d guide.");
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
    runtime.runTick();
    expect(record.terminal.line(1).trimEnd()).toBe("Computer System Linux 1.0");
    expect(record.terminal.line(2).trimEnd()).toBe("");
    expect(record.terminal.line(3).trimEnd()).toBe(
      "Welcome to CS-Linux 1.0. Type 'help' for commands or 'man cs-linux' for the fiel",
    );
    expect(record.terminal.line(4).trimEnd()).toBe("d guide.");
    expect(record.terminal.line(5).trimEnd()).toBe("cs@computer-30:~$");
    expect(record.terminal.cell(1, 1).foreground).toBe(0);
    expect(record.terminal.cell(1, 5).foreground).toBe(0);
    expect(record.lifecycle.state).toEqual({
      kind: "waiting_event",
      filter: undefined,
    });
    runtime.queueEvent(record.computerId, "terminal_line", "vi /startup.py");
    runtime.runTick();
    expect(record.terminal.line(1)).toContain("VI  /startup.py");
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
    runtime.runTick();
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
    for (let tick = 0; tick < 14; tick += 1) runtime.runTick();

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
    runtime.runTick();

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
    runtime.runTick();

    runtime.queueEvent(record.computerId, "terminal_line", "vi demo.py");
    runtime.runTick();
    expect(record.terminal.line(1)).toContain("VI  /home/cs/demo.py");
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
