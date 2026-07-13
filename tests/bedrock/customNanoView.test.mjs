import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");

describe("nano-style Bedrock UI probe", () => {
  it("renders a buttonless editor viewport with one native current-line input", async () => {
    const source = await readFile(
      path.join(root, "src/bedrock/customNanoView.tsx"),
      "utf8",
    );

    expect(source).toContain('name={"line"}');
    expect(source).toContain("GNU nano 8.0");
    expect(source).toContain(":w Write");
    expect(source).toContain(":q Quit");
    expect(source).not.toContain('type={"exit"}');
    expect(source).toMatch(
      /<Form\.Button[\s\S]*?type=\{"submit"\}[\s\S]*?visible=\{false\}[\s\S]*?width=\{0\}[\s\S]*?height=\{0\}/u,
    );
  });

  it("exposes explicit save, close, and failure records", async () => {
    const [view, probe] = await Promise.all([
      readFile(path.join(root, "src/bedrock/customNanoView.tsx"), "utf8"),
      readFile(path.join(root, "src/bedrock/probes/uiProbe.ts"), "utf8"),
    ]);

    expect(view).toContain("handlers.onSave");
    expect(view).toContain("handlers.onClosed");
    expect(view).toContain("CS_NANO_ERROR");
    expect(probe).toContain("CS_NANO_SAVE");
    expect(probe).toContain("CS_NANO_CLOSE");
  });
});
