import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");

describe("Bedrock terminal adapters", () => {
  it("adds the terminal header before interactive controls", async () => {
    const terminalView = await source("src/bedrock/terminalView.ts");
    expect(terminalView.indexOf(".label(display)")).toBeLessThan(
      terminalView.indexOf('.textField("Input", input)'),
    );
  });

  it("maps every terminal palette index to a distinct native formatting color", async () => {
    const terminalView = await source("src/bedrock/terminalView.ts");
    const paletteSource = terminalView.match(
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
    expect(pocket).toContain("openComputerTerminal");
    expect(pocket).not.toContain("showTerminalProbe");
    expect(coordinator).toContain("showTerminalView");
    expect(coordinator).toContain('"terminal_line"');
    expect(coordinator).toContain('"terminal_closed"');
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
