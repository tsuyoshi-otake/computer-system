import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");

describe("Bedrock Floppy Disk adapter", () => {
  it("registers the adapter after storage migration and before Web sessions", async () => {
    const main = await source("src/bedrock/main.ts");
    expect(main).toContain("startFloppyComponent()");
    expect(main.indexOf("startFloppyComponent()")).toBeLessThan(
      main.indexOf("startWebTerminalBridge()"),
    );
  });

  it("preserves crashed+sneak safe boot and limits sneak eject to an empty hand", async () => {
    const floppy = await source("src/bedrock/floppyComponent.ts");
    expect(floppy).toContain('record.lifecycle.state.kind === "crashed"');
    expect(floppy).toContain("player.isSneaking");
    expect(floppy).toContain("return false;");
    expect(floppy).toContain("held === undefined");
    expect(floppy).toContain("computerHost.runtime.floppyDrive");
  });

  it("carries stable media identity and rolls back failed delivery", async () => {
    const floppy = await source("src/bedrock/floppyComponent.ts");
    expect(floppy).toContain("computer_system:floppy_media_id");
    expect(floppy).toContain("computer_system:floppy_generation");
    expect(floppy).toContain("floppyMediaService().create()");
    expect(floppy).toContain("floppyMediaService().insert");
    expect(floppy).toContain("floppyMediaService().eject");
    expect(floppy).toContain("Floppy eject delivery and rollback failed");
    expect(floppy).toContain("giveOrDropItem");
  });

  it("ejects before break finalization without preventing the shutdown owner", async () => {
    const computer = await source("src/bedrock/computerComponent.ts");
    expect(computer).toContain("ejectFloppyForBreak(");
    expect(computer.indexOf("ejectFloppyForBreak(")).toBeLessThan(
      computer.indexOf("scheduleOwnedFinalization("),
    );
  });
});

async function source(relative) {
  return readFile(path.join(root, relative), "utf8");
}
