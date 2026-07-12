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
});

async function source(relative) {
  return readFile(path.join(root, relative), "utf8");
}
