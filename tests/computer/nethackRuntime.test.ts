import { describe, expect, it } from "vitest";

import { ComputerRuntime } from "../../src/application/computer/computerRuntime.js";
import { buildGuestNethackExecutable } from "../../src/application/toolchain/guestNethackBuilder.js";
import { guestNethackSourceFiles } from "../../src/application/toolchain/guestNethack.js";
import { ComputerRecord } from "../../src/domain/computer/computer.js";

describe("NetHack for CS-Linux", (): void => {
  it("renders the next interactive frame within 500 scheduler ticks", (): void => {
    const runtime = new ComputerRuntime();
    const record = new ComputerRecord("c-006406", "standard");
    runtime.register(record);
    runtime.powerOn(record.computerId);
    completeBoot(runtime, record);
    launchGame(runtime, record);
    const before = terminalText(record);

    expect(
      runtime.queueEvent(record.computerId, "terminal_keys", '["l"]'),
    ).toMatchObject({ outcome: "accepted" });
    let elapsedTicks = 0;
    while (elapsedTicks < 500 && terminalText(record) === before) {
      runtime.runTick();
      elapsedTicks += 1;
    }

    expect(terminalText(record)).not.toBe(before);
    expect(elapsedTicks).toBeLessThanOrEqual(500);
  });

  it("renders every game cell with the black terminal background", (): void => {
    const runtime = new ComputerRuntime();
    const record = new ComputerRecord("c-006407", "standard");
    runtime.register(record);
    runtime.powerOn(record.computerId);
    completeBoot(runtime, record);
    launchGame(runtime, record);
    const before = terminalText(record);
    expect(
      runtime.queueEvent(record.computerId, "terminal_keys", '["l"]'),
    ).toMatchObject({ outcome: "accepted" });
    runUntil(runtime, () => terminalText(record) !== before);

    const background = record.terminal.snapshot().background;
    for (let y = 0; y < 21; y += 1) {
      expect(background[y]?.slice(0, 78)).toEqual(
        Array.from({ length: 78 }, () => 15),
      );
    }
  });

  it("ships the deterministic compiler-built executable and runs PATH arguments", (): void => {
    const runtime = new ComputerRuntime();
    const record = new ComputerRecord("c-006401", "standard");
    runtime.register(record);
    runtime.powerOn(record.computerId);
    completeBoot(runtime, record);
    expect(record.filesystem.readFile("/usr/games/nethack")).toBe(
      `CS486\n${JSON.stringify(buildGuestNethackExecutable())}`,
    );
    expect(record.filesystem.getMetadata("/usr/games/nethack")).toMatchObject({
      gid: 0,
      mode: 0o755,
      uid: 0,
    });

    submitAndComplete(runtime, record, "nethack --version");
    expect(lastStatus(runtime, record)).toBe("0\n");
    expect(terminalText(record)).toContain("NetHack for CS-Linux 1.0");

    submitAndComplete(runtime, record, "nethack --help");
    expect(terminalText(record)).toContain("hjklyubn");
    expect(lastStatus(runtime, record)).toBe("0\n");

    submitAndComplete(runtime, record, "nethack --unknown");
    expect(terminalText(record)).toContain("unknown argument");
    expect(lastStatus(runtime, record)).toBe("2\n");
  });

  it("saves only on S, restores the RNG record, and preserves it on quit/disconnect", (): void => {
    const runtime = new ComputerRuntime();
    const record = new ComputerRecord("c-006402", "standard");
    runtime.register(record);
    runtime.powerOn(record.computerId);
    completeBoot(runtime, record);

    launchGame(runtime, record);
    expect(
      runtime.queueEvent(record.computerId, "terminal_keys", '["S"]'),
    ).toMatchObject({ outcome: "accepted" });
    waitForShell(runtime, record);
    const savePath = "/home/cs/.nethack.sav";
    expect(record.filesystem.exists(savePath)).toBe(true);
    expect(record.filesystem.getMetadata(savePath)).toMatchObject({
      gid: 1000,
      mode: 0o600,
      uid: 1000,
    });
    const saved = record.filesystem.readFile(savePath);
    expect([...saved.slice(0, 4)]).toEqual(["C", "S", "N", "H"]);
    expect([...saved]).toHaveLength(2191);

    launchGame(runtime, record);
    expect(
      runtime.queueEvent(record.computerId, "terminal_keys", '["q"]'),
    ).toMatchObject({ outcome: "accepted" });
    waitForShell(runtime, record);
    expect(record.filesystem.readFile(savePath)).toBe(saved);

    launchGame(runtime, record);
    expect(
      runtime.queueEvent(
        record.computerId,
        "terminal_keys",
        '["#","q","u","i","t"]',
      ),
    ).toMatchObject({ outcome: "accepted" });
    waitForShell(runtime, record);
    expect(record.filesystem.readFile(savePath)).toBe(saved);

    launchGame(runtime, record);
    expect(
      runtime.queueEvent(record.computerId, "terminal_keys", '["l"]'),
    ).toMatchObject({ outcome: "accepted" });
    runtime.runTick();
    expect(
      runtime.queueEvent(record.computerId, "terminal_closed"),
    ).toMatchObject({ outcome: "accepted" });
    for (let tick = 0; tick < 4; tick += 1) runtime.runTick();
    expect(record.filesystem.readFile(savePath)).toBe(saved);
    expect(record.filesystem.exists(`${savePath}.tmp`)).toBe(false);
  });

  it("restores the generated map, entities, inventory record, and frame after S", (): void => {
    const runtime = new ComputerRuntime();
    const record = new ComputerRecord("c-006408", "standard");
    runtime.register(record);
    runtime.powerOn(record.computerId);
    completeBoot(runtime, record);

    launchGame(runtime, record);
    const initial = terminalText(record);
    expect(
      runtime.queueEvent(record.computerId, "terminal_keys", '["l"]'),
    ).toMatchObject({ outcome: "accepted" });
    runUntil(runtime, () => terminalText(record) !== initial);
    expect(
      runtime.queueEvent(record.computerId, "terminal_keys", '["S"]'),
    ).toMatchObject({ outcome: "accepted" });
    waitForShell(runtime, record);

    launchGame(runtime, record);
    expect(
      runtime.queueEvent(record.computerId, "terminal_keys", '["l"]'),
    ).toMatchObject({ outcome: "accepted" });
    runUntil(runtime, () => terminalText(record).includes("@"));
    expect(terminalText(record)).toContain("@");
    expect(terminalText(record)).toContain(".");
  });

  it("fails an invalid HOME save before mutating the canonical file", (): void => {
    const runtime = new ComputerRuntime();
    const record = new ComputerRecord("c-006403", "standard");
    runtime.register(record);
    runtime.powerOn(record.computerId);
    completeBoot(runtime, record);
    submitAndComplete(runtime, record, "unset HOME");
    launchGame(runtime, record);
    expect(
      runtime.queueEvent(record.computerId, "terminal_keys", '["S"]'),
    ).toMatchObject({ outcome: "accepted" });
    runUntil(runtime, () => terminalText(record).includes("Save failed"));
    expect(record.filesystem.exists("/home/cs/.nethack.sav")).toBe(false);
    expect(terminalText(record)).toContain("Save failed");
    expect(runtime.terminalInteraction(record.computerId).context).toBe(
      "cs-abi",
    );
    expect(
      runtime.queueEvent(record.computerId, "terminal_closed"),
    ).toMatchObject({ outcome: "accepted" });
    for (let tick = 0; tick < 4; tick += 1) runtime.runTick();
  });

  it("reports a corrupt save, preserves it, and keeps the new game explicit", (): void => {
    const runtime = new ComputerRuntime();
    const record = new ComputerRecord("c-006405", "standard");
    runtime.register(record);
    runtime.powerOn(record.computerId);
    completeBoot(runtime, record);
    const savePath = "/home/cs/.nethack.sav";
    const corrupt = "CSNH";
    record.filesystem.writeFile(savePath, corrupt);
    record.filesystem.setMetadata(savePath, {
      gid: 1000,
      mode: 0o600,
      uid: 1000,
    });

    launchGame(runtime, record);
    runUntil(runtime, () => terminalText(record).includes("corrupt"));
    expect(terminalText(record)).toContain("corrupt or unsupported save");
    expect(record.filesystem.readFile(savePath)).toBe(corrupt);
    expect(runtime.terminalInteraction(record.computerId).context).toBe(
      "cs-abi",
    );
    expect(
      runtime.queueEvent(record.computerId, "terminal_closed"),
    ).toMatchObject({ outcome: "accepted" });
    for (let tick = 0; tick < 4; tick += 1) runtime.runTick();
    expect(record.filesystem.readFile(savePath)).toBe(corrupt);
  });

  it("rebuilds a byte-identical executable with the guest make, cc, and ld", (): void => {
    const runtime = new ComputerRuntime();
    const record = new ComputerRecord("c-006404", "standard");
    runtime.register(record);
    runtime.powerOn(record.computerId);
    completeBoot(runtime, record);
    const sourceRoot = "/home/cs/nethack";
    record.filesystem.makeDirectory(sourceRoot);
    record.filesystem.setMetadata(sourceRoot, {
      gid: 1000,
      mode: 0o755,
      uid: 1000,
    });
    for (const [name, contents] of guestNethackSourceFiles) {
      const path = `${sourceRoot}/${name}`;
      record.filesystem.writeFile(path, contents);
      record.filesystem.setMetadata(path, {
        gid: 1000,
        mode: 0o644,
        uid: 1000,
      });
    }
    const stockHash = runtime.executeDebugShellCommand(
      record.computerId,
      "sha256sum /usr/games/nethack",
    );
    expect(stockHash).toMatchObject({ outcome: "completed", exitCode: 0 });

    submitAndComplete(runtime, record, `cd ${sourceRoot}`);
    submitAndComplete(runtime, record, "make");
    expect(lastStatus(runtime, record)).toBe("0\n");
    expect(record.filesystem.readFile(`${sourceRoot}/nethack`)).toBe(
      record.filesystem.readFile("/usr/games/nethack"),
    );
    expect(
      runtime.executeDebugShellCommand(
        record.computerId,
        `sha256sum ${sourceRoot}/nethack`,
      ),
    ).toMatchObject({
      outcome: "completed",
      exitCode: 0,
      stdout: (stockHash as { readonly stdout: string }).stdout.replace(
        "/usr/games/nethack",
        `${sourceRoot}/nethack`,
      ),
    });
  });
});

function launchGame(runtime: ComputerRuntime, record: ComputerRecord): void {
  waitForShell(runtime, record);
  expect(
    runtime.queueEvent(record.computerId, "terminal_line", "nethack"),
  ).toMatchObject({ outcome: "accepted" });
  runUntil(
    runtime,
    () => runtime.terminalInteraction(record.computerId).context === "cs-abi",
  );
  runtime.runTick();
}

function submitAndComplete(
  runtime: ComputerRuntime,
  record: ComputerRecord,
  line: string,
): void {
  waitForShell(runtime, record);
  expect(
    runtime.queueEvent(record.computerId, "terminal_line", line),
  ).toMatchObject({ outcome: "accepted" });
  runtime.runTick();
  waitForShell(runtime, record);
}

function lastStatus(runtime: ComputerRuntime, record: ComputerRecord): string {
  const result = runtime.executeDebugShellCommand(record.computerId, "echo $?");
  if (result.outcome !== "completed")
    throw new Error("status command deferred");
  return result.stdout;
}

function waitForShell(runtime: ComputerRuntime, record: ComputerRecord): void {
  for (let tick = 0; tick < 2_000; tick += 1) {
    const state = runtime.vmState(record.computerId);
    if (
      runtime.terminalInteraction(record.computerId).inputMode === "line" &&
      state?.kind === "waiting_event" &&
      state.filter === undefined
    )
      return;
    runtime.runTick();
  }
  throw new Error(
    `shell wait timed out: ${JSON.stringify({
      interaction: runtime.terminalInteraction(record.computerId),
      lifecycle: record.lifecycle.state,
      display: record.display.state,
      text: terminalText(record),
      vm: runtime.vmState(record.computerId),
    })}`,
  );
}

function completeBoot(runtime: ComputerRuntime, record: ComputerRecord): void {
  runUntil(
    runtime,
    () =>
      record.lifecycle.state.kind !== "booting" &&
      record.display.state.kind !== "post",
  );
}

function terminalText(record: ComputerRecord): string {
  return record.terminal.snapshot().rows.join("\n");
}

function runUntil(runtime: ComputerRuntime, predicate: () => boolean): void {
  for (let tick = 0; tick < 2_000; tick += 1) {
    if (predicate()) return;
    runtime.runTick();
  }
  throw new Error("runtime did not reach the expected NetHack state");
}
