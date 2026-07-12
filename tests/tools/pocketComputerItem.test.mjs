import { describe, expect, it } from "vitest";

import {
  createPocketComputerItem,
  pocketComputerIdentifier,
} from "../../tools/pocket-computer-item.mjs";

describe("pocket computer item", () => {
  it("is non-stackable and attaches the stable custom item component", () => {
    const item = createPocketComputerItem()["minecraft:item"];
    expect(item.description.identifier).toBe(pocketComputerIdentifier);
    expect(item.components["minecraft:max_stack_size"]).toBe(1);
    expect(item.components["minecraft:durability"].max_durability).toBe(1);
    expect(item.components["computer_system:pocket_computer"]).toEqual({});
  });
});
