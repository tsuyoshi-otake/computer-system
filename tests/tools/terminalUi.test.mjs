import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");

describe("Bedrock Core companion Resource Pack", () => {
  it("registers the matching v0007 modal decoder", async () => {
    const [definitions, serverForm, modalContainer, input] = await Promise.all([
      source("packs/resource/ui/_ui_defs.json"),
      source("packs/resource/ui/server_form.json"),
      source("packs/resource/ui/core-ui/common/modal_container.json"),
      source("packs/resource/ui/core-ui/form_components/input.json"),
    ]);

    expect(definitions).toContain("ui/core-ui/common/modal_container.json");
    expect(definitions).toContain("ui/core-ui/form_components/input.json");
    expect(serverForm).toContain('"$protocol_header": "bcuiv0007"');
    expect(serverForm).toContain(
      '"custom_form": "@core_ui_common.modal_container"',
    );
    expect(modalContainer).toContain("flow_submit_anchor");
    expect(modalContainer).toContain("flow_exit_anchor");
    expect(input).toMatch(
      /"from_button_id": "button\.menu_ok"[\s\S]*?"to_button_id": "button\.submit_custom_form"[\s\S]*?"mapping_type": "focused"/u,
    );
  });

  it("ships every custom texture referenced by the terminal prototype", async () => {
    await Promise.all(
      [
        "packs/resource/textures/ui/pointer.png",
        "packs/resource/textures/ui/unstyled.png",
        "packs/resource/textures/ui/ore-styled/field/background.png",
        "packs/resource/textures/ui/ore-styled/button/primary/background.png",
        "packs/resource/textures/ui/ore-styled/button/danger/background.png",
      ].map((relative) => access(path.join(root, relative))),
    );
  });

  it("keeps the runtime and decoder provenance together", async () => {
    const provenance = await source("vendor/bedrock-core-ui-0.9.2/README.md");
    const license = await source("vendor/bedrock-core-ui-0.9.2/LICENSE");

    expect(provenance).toContain("Version: 0.9.2");
    expect(provenance).toContain("5e87db65007cf554328374aa9aa6363034f3512d");
    expect(license).toContain("MIT License");
  });
});

async function source(relative) {
  return readFile(path.join(root, relative), "utf8");
}
