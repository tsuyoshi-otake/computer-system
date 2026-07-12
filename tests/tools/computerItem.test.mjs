import { describe, expect, it } from "vitest";

import {
  computerItemIdentifier,
  createComputerItem,
} from "../../tools/computer-item.mjs";

describe("computer item generator", () => {
  it.each(["computer", "advanced_computer"])(
    "creates the %s identity-carrying item",
    (family) => {
      const item = createComputerItem(family)["minecraft:item"];
      expect(item.description.identifier).toBe(computerItemIdentifier(family));
      expect(item.components["computer_system:computer_item"]).toEqual({
        family,
      });
      expect(item.components["minecraft:max_stack_size"]).toBe(1);
    },
  );
});
