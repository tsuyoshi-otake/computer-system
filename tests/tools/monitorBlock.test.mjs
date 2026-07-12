import { describe, expect, it } from "vitest";

import {
  createMonitorBlock,
  monitorIdentifier,
} from "../../tools/monitor-block.mjs";

describe("monitor block", () => {
  it("uses a current direct custom-component key", () => {
    const block = createMonitorBlock()["minecraft:block"];
    expect(block.description.identifier).toBe(monitorIdentifier);
    expect(block.components["computer_system:monitor"]).toEqual({});
  });
});
