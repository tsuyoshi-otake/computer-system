export const machineFaces = [
  "bottom",
  "right",
  "front",
  "back",
  "top",
  "left",
] as const;

export type MachineFace = (typeof machineFaces)[number];

export type MachineCardinalDirection = "east" | "north" | "south" | "west";
export type MachineWorldDirection =
  "down" | "east" | "north" | "south" | "up" | "west";

const oppositeFaces: Readonly<Record<MachineFace, MachineFace>> = {
  bottom: "top",
  right: "left",
  front: "back",
  back: "front",
  top: "bottom",
  left: "right",
};

export function isMachineFace(value: string): value is MachineFace {
  return machineFaces.includes(value as MachineFace);
}

export function machineFaceIndex(face: MachineFace): number {
  return machineFaces.indexOf(face);
}

export function machineFaceAt(index: number): MachineFace {
  if (!Number.isInteger(index) || index < 0 || index >= machineFaces.length) {
    throw new RangeError("Machine face index must be between 0 and 5");
  }
  return machineFaces[index]!;
}

export function oppositeMachineFace(face: MachineFace): MachineFace {
  return oppositeFaces[face];
}

export function worldDirectionForMachineFace(
  face: MachineFace,
  front: MachineCardinalDirection,
): MachineWorldDirection {
  if (face === "bottom") return "down";
  if (face === "top") return "up";
  return horizontalFacesByFront[front][face];
}

export function machineFaceForWorldDirection(
  direction: MachineWorldDirection,
  front: MachineCardinalDirection,
): MachineFace {
  if (direction === "down") return "bottom";
  if (direction === "up") return "top";
  const horizontal = horizontalFacesByFront[front];
  for (const face of ["right", "front", "back", "left"] as const) {
    if (horizontal[face] === direction) return face;
  }
  throw new Error(`Unable to resolve machine face for ${direction}`);
}

export function oppositeWorldDirection(
  direction: MachineWorldDirection,
): MachineWorldDirection {
  switch (direction) {
    case "down":
      return "up";
    case "east":
      return "west";
    case "north":
      return "south";
    case "south":
      return "north";
    case "up":
      return "down";
    case "west":
      return "east";
  }
}

const horizontalFacesByFront: Readonly<
  Record<
    MachineCardinalDirection,
    Readonly<
      Record<Exclude<MachineFace, "bottom" | "top">, MachineWorldDirection>
    >
  >
> = {
  north: { front: "north", back: "south", right: "east", left: "west" },
  south: { front: "south", back: "north", right: "west", left: "east" },
  east: { front: "east", back: "west", right: "south", left: "north" },
  west: { front: "west", back: "east", right: "north", left: "south" },
};
