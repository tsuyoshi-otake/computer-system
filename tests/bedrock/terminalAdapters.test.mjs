import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");

describe("Bedrock terminal adapters", () => {
  it("adds the terminal header before interactive controls", async () => {
    const terminalView = await source("src/bedrock/terminalView.ts");
    expect(terminalView.indexOf(".label(display)")).toBeLessThan(
      terminalView.indexOf('.textField("Command line", input)'),
    );
    expect(terminalView).toContain('.button("Enter"');
    expect(terminalView).toContain('.button("Ctrl+C"');
    expect(terminalView).not.toContain("form.closeButton()");
  });

  it("maps every terminal palette index to a distinct native formatting color", async () => {
    const viewport = await source("src/application/terminal/viewport.ts");
    const paletteSource = viewport.match(
      /const formattingCodes = \[([\s\S]*?)\] as const;/u,
    )?.[1];
    const codes = [...(paletteSource ?? "").matchAll(/"([0-9a-f])"/gu)].map(
      (match) => match[1],
    );

    expect(codes).toHaveLength(16);
    expect(new Set(codes)).toHaveProperty("size", 16);
  });

  it("routes Computer and Pocket Computer through the production coordinator", async () => {
    const [computer, pocket, coordinator] = await Promise.all([
      source("src/bedrock/computerComponent.ts"),
      source("src/bedrock/pocketComputer.ts"),
      source("src/bedrock/computerTerminal.ts"),
    ]);

    expect(computer).toContain("openComputerTerminal");
    expect(pocket).toContain("requestWebComputerTerminal");
    expect(pocket).toContain("resolvePocketComputer(source, itemStack)");
    expect(pocket).toContain("Pocket Computer initialized");
    expect(pocket).toContain(
      "inventory.setItem(player.selectedSlotIndex, selectedItem)",
    );
    expect(pocket).not.toContain("showTerminalProbe");
    expect(coordinator).toContain("showTerminalView");
    expect(coordinator).toContain('"terminal_line"');
    expect(coordinator).toContain('"terminal_closed"');
  });

  it("normalizes the GDK single-entity item-drop shape and keeps the world in daytime", async () => {
    const [pocket, daylight, main, headless] = await Promise.all([
      source("src/bedrock/pocketComputer.ts"),
      source("src/bedrock/daylightController.ts"),
      source("src/bedrock/main.ts"),
      source("src/bedrock/probes/headlessProbe.ts"),
    ]);

    expect(pocket).toContain("Array.isArray(items) ? items : [items]");
    expect(pocket).not.toContain("for (const entity of items)");
    expect(daylight).toContain("world.gameRules.doDayLightCycle = false");
    expect(daylight).toContain("world.setTimeOfDay(TimeOfDay.Day)");
    expect(daylight).toContain("system.runInterval");
    expect(daylight).toContain("inspectAlwaysDayState");
    expect(main).toContain("startAlwaysDayController()");
    expect(headless).toContain('emit(runId, "always_day"');
  });

  it("hands Pocket Computer use to the bounded Web companion bridge", async () => {
    const [main, pocket, bridge] = await Promise.all([
      source("src/bedrock/main.ts"),
      source("src/bedrock/pocketComputer.ts"),
      source("src/bedrock/webTerminalBridge.ts"),
    ]);

    expect(main).toContain("startWebTerminalBridge");
    expect(main).toContain("handleWebTerminalScriptEvent");
    expect(pocket).toContain("requestWebComputerTerminal(source, record)");
    expect(bridge).toContain("CS_WEB_SESSION_REQUEST");
    expect(bridge).toContain("CS_WEB_TERMINAL");
    expect(bridge).toContain("maxSnapshotsPerPass = 2");
    expect(bridge).toContain("maxEagerSnapshotsPerPass = 4");
    expect(bridge).toContain("TerminalSnapshotScheduler");
    expect(bridge).toContain("snapshotScheduler.requestEager");
    expect(bridge).toContain("snapshotScheduler.takePeriodicBatch");
    expect(bridge).toContain('"terminal_line"');
    expect(bridge).toContain('"terminal_keys"');
    expect(bridge).toContain("isTerminalKeyBatch");
    expect(bridge).toContain('"terminal_closed"');
    expect(bridge).toContain("openFallback");
    expect(bridge).toContain("WebTerminalAccessRegistry");
    expect(bridge).toContain("terminalAccess.canWrite");
    expect(bridge).toContain("detached.wasLast");
    expect(bridge).toContain("rejectSession");
  });

  it("keeps the Bedrock Core prototype isolated from the production DDUI coordinator", async () => {
    const [main, probe, coordinator] = await Promise.all([
      source("src/bedrock/main.ts"),
      source("src/bedrock/probes/uiProbe.ts"),
      source("src/bedrock/computerTerminal.ts"),
    ]);

    expect(main).toContain('case "ui-custom"');
    expect(main).toContain('case "ui-nano"');
    expect(probe).toContain("showCustomTerminalProbe");
    expect(probe).toContain("showNanoProbe");
    expect(probe).toContain("showCustomTerminalView");
    expect(coordinator).toContain("showTerminalView");
    expect(coordinator).not.toContain("showCustomTerminalView");
  });

  it("routes Monitor touch to the latest selected production computer", async () => {
    const [monitor, coordinator] = await Promise.all([
      source("src/bedrock/monitorComponent.ts"),
      source("src/bedrock/computerTerminal.ts"),
    ]);

    expect(monitor).toContain("openSelectedComputerTerminal");
    expect(monitor).not.toContain("showTerminalProbe");
    expect(coordinator).toContain("TerminalTargetRegistry");
    expect(coordinator).toContain("targets.resolve(player.id)");
  });

  it("guards a broken Computer coordinate until residual block cleanup finishes", async () => {
    const computer = await source("src/bedrock/computerComponent.ts");

    expect(computer).toContain("scheduleOwnedFinalization(");
    expect(computer).toContain("if (breakingBlocks.has(physicalKey)) return");
    expect(computer).toContain('residual.setType("minecraft:air")');
    expect(computer).toContain("giveComputerItem(player");
  });

  it("exposes a bounded GDK competing-form probe with per-session finalization counts", async () => {
    const [main, probe] = await Promise.all([
      source("src/bedrock/main.ts"),
      source("src/bedrock/probes/uiProbe.ts"),
    ]);

    expect(main).toContain('case "compete"');
    expect(probe).toContain("startTerminalCompetitionProbe");
    expect(probe).toContain("CS_TERMINAL_COMPETE");
    expect(probe).toContain('report("challenger", kind, detail)');
    expect(probe).toContain('report("holder", kind, detail)');
  });

  it("records real-player terminal closure for the isolated BDS disconnect harness", async () => {
    const [probe, runner, packageJson] = await Promise.all([
      source("src/bedrock/probes/uiProbe.ts"),
      source("tools/bds-probe-runner.mjs"),
      source("package.json"),
    ]);

    expect(probe).toContain("CS_TERMINAL_CLOSE");
    expect(runner).toContain('process.argv.includes("--disconnect")');
    expect(runner).toContain("BDS_DISCONNECT_READY");
    expect(runner).toContain("verifyDisconnect(session)");
    expect(runner).toContain("session.terminalCloseRecords.length !== 1");
    expect(runner).toContain('"runtime"');
    expect(runner).toContain("resetManagedDirectory(workRoot)");
    expect(runner).toContain(
      "const executable = path.join(serverRoot, executableName)",
    );
    expect(packageJson).toContain('"test:bds:disconnect"');
  });

  it("exposes bounded background and continuous-output GDK probes", async () => {
    const [main, probe] = await Promise.all([
      source("src/bedrock/main.ts"),
      source("src/bedrock/probes/uiProbe.ts"),
    ]);

    expect(main).toContain('case "stream"');
    expect(probe).toContain("startTerminalStreamProbe");
    expect(probe).toContain("CS_TERMINAL_STREAM");
    expect(probe).toContain("updates !== 200");
    expect(probe).toContain("system.clearRun(streamRun)");
    expect(probe).toContain('color === 15 ? "█" : " "');
  });
});

async function source(relative) {
  return readFile(path.join(root, relative), "utf8");
}
