import { describe, expect, it } from "vitest";

import {
  createPortableComputerItem,
  portableComputerDisplayName,
  portableComputerIdentifier,
  portableComputerTextureKey,
} from "../../tools/portable-computer-item.mjs";
import { machineTextureKeys } from "../../tools/machine-textures.mjs";

describe("portable computer item", () => {
  it("is non-stackable and attaches the stable custom item component", () => {
    const item = createPortableComputerItem()["minecraft:item"];
    expect(item.description.identifier).toBe(portableComputerIdentifier);
    expect(item.components["minecraft:max_stack_size"]).toBe(1);
    expect(item.components).not.toHaveProperty("minecraft:food");
    expect(item.components["minecraft:icon"]).toBe(portableComputerTextureKey);
    expect(item.components["minecraft:interact_button"]).toBe("Open Terminal");
    expect(item.components["minecraft:display_name"]).toEqual({
      value: portableComputerDisplayName,
    });
    expect(portableComputerDisplayName).toBe("Computer System LTE 386SX");
    expect(item.components).not.toHaveProperty("minecraft:use_animation");
    expect(item.components).not.toHaveProperty("minecraft:use_modifiers");
    expect(item.components["computer_system:portable_computer"]).toEqual({});
  });

  it("uses the authored portable machine texture", () => {
    expect(portableComputerTextureKey).toBe(
      machineTextureKeys.portable_computer,
    );
  });
});
