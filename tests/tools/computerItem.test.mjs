import { describe, expect, it } from "vitest";

import {
  computerItemDisplayNames,
  computerItemIdentifier,
  createComputerItem,
} from "../../tools/computer-item.mjs";
import { machineTextureKeys } from "../../tools/machine-textures.mjs";

describe("computer item generator", () => {
  it("uses the Deskpro family names for both desktop profiles", () => {
    expect(computerItemDisplayNames).toEqual({
      advanced_computer: "Computer System Deskpro 486DX2",
      computer: "Computer System Deskpro 486DX",
    });
  });

  it.each(["computer", "advanced_computer"])(
    "creates the %s identity-carrying item",
    (family) => {
      const item = createComputerItem(family)["minecraft:item"];
      expect(item.description.identifier).toBe(computerItemIdentifier(family));
      expect(item.components["computer_system:computer_item"]).toEqual({
        family,
      });
      expect(item.components["minecraft:max_stack_size"]).toBe(1);
      expect(item.components["minecraft:display_name"]).toEqual({
        value: computerItemDisplayNames[family],
      });
      expect(item.components["minecraft:icon"]).toBe(
        machineTextureKeys[family],
      );
    },
  );
});
