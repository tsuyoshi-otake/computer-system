import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");

describe("Bedrock Core terminal prototype", () => {
  it("uses the modal root scroll and keeps the command controls compact", async () => {
    const source = await readFile(
      path.join(root, "src/bedrock/customTerminalView.tsx"),
      "utf8",
    );
    const input = source.indexOf("<Form.Input");
    const hiddenSubmit = source.match(
      /<Form\.Button[\s\S]*?type=\{"submit"\}[\s\S]*?visible=\{false\}[\s\S]*?width=\{0\}[\s\S]*?height=\{0\}/u,
    );

    expect(source).not.toContain("<Scroll");
    expect(source).not.toContain("Scroll,");
    expect(input).toBeGreaterThan(0);
    expect(hiddenSubmit).not.toBeNull();
    expect(source).not.toContain('type={"exit"}');
    expect(source).not.toContain('label={"Enter"}');
    expect(source).not.toContain('label={"Ctrl+C"}');
  });

  it("uses one native input submission and explicitly finalizes cancellation", async () => {
    const source = await readFile(
      path.join(root, "src/bedrock/customTerminalView.tsx"),
      "utf8",
    );

    expect(source).toContain('name={"command"}');
    expect(source).toContain("session.submitLine(line)");
    expect(source).toContain("session.requestTermination()");
    expect(source).toContain('session.finalizeClose("ServerClosed")');
    expect(source).toContain("session.finalizeFailure(error, player.isValid)");
    expect(source).toContain("uiManager.closeAllForms(player)");
    expect(source).toContain("exit();");
  });

  it("ships the separate custom probe and an observable close record", async () => {
    const source = await readFile(
      path.join(root, "src/bedrock/probes/uiProbe.ts"),
      "utf8",
    );

    expect(source).toContain("showCustomTerminalProbe");
    expect(source).toContain("CS_CUSTOM_TERMINAL_CLOSE");
    expect(source).toContain("Bedrock Core UI 0.9.2 prototype");
  });
});
