import { describe, expect, it } from "vitest";

import {
  machineFaceForWorldDirection,
  machineFaceAt,
  machineFaceIndex,
  machineFaces,
  oppositeMachineFace,
  worldDirectionForMachineFace,
} from "../../src/domain/computer/machineFace.js";

describe("machine face model", (): void => {
  it("keeps the persisted six-face order stable", (): void => {
    expect(machineFaces).toEqual([
      "bottom",
      "right",
      "front",
      "back",
      "top",
      "left",
    ]);
    expect(machineFaces.map(machineFaceIndex)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(machineFaces.map((_face, index) => machineFaceAt(index))).toEqual(
      machineFaces,
    );
  });

  it("maps every face to one reciprocal face", (): void => {
    for (const face of machineFaces) {
      expect(oppositeMachineFace(oppositeMachineFace(face))).toBe(face);
    }
    expect(oppositeMachineFace("front")).toBe("back");
    expect(oppositeMachineFace("right")).toBe("left");
    expect(oppositeMachineFace("top")).toBe("bottom");
  });

  it("rotates horizontal faces with the chassis and keeps vertical faces fixed", (): void => {
    expect(worldDirectionForMachineFace("front", "north")).toBe("north");
    expect(worldDirectionForMachineFace("right", "north")).toBe("east");
    expect(worldDirectionForMachineFace("right", "south")).toBe("west");
    expect(worldDirectionForMachineFace("right", "east")).toBe("south");
    expect(worldDirectionForMachineFace("top", "west")).toBe("up");
    expect(machineFaceForWorldDirection("west", "south")).toBe("right");
    expect(machineFaceForWorldDirection("down", "east")).toBe("bottom");
  });
});
