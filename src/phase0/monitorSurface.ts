export interface MonitorTile {
  readonly x: number;
  readonly y: number;
}

export interface MonitorSurface {
  readonly height: number;
  readonly origin: MonitorTile;
  readonly tiles: readonly MonitorTile[];
  readonly width: number;
}

export type MonitorDiscovery =
  | { readonly outcome: "connected"; readonly surface: MonitorSurface }
  | { readonly outcome: "empty" }
  | { readonly outcome: "disconnected" }
  | { readonly outcome: "non-rectangular" }
  | { readonly outcome: "too-large"; readonly maximum: number };

export interface MonitorCell {
  readonly x: number;
  readonly y: number;
}

export type MonitorTouch =
  | { readonly outcome: "mapped"; readonly cell: MonitorCell }
  | { readonly outcome: "outside" };

export interface MonitorUpdate extends MonitorCell {
  readonly character: string;
}

export interface MonitorFlush {
  readonly remaining: number;
  readonly updates: readonly MonitorUpdate[];
}

const directions = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
] as const;

export function discoverMonitorSurface(
  tiles: readonly MonitorTile[],
  maximumTiles = 6,
): MonitorDiscovery {
  const unique = new Map(tiles.map((tile) => [key(tile), tile]));
  if (unique.size === 0) return { outcome: "empty" };
  if (unique.size > maximumTiles) {
    return { outcome: "too-large", maximum: maximumTiles };
  }

  const first = unique.values().next().value as MonitorTile;
  const visited = new Set<string>([key(first)]);
  const pending = [first];
  while (pending.length > 0) {
    const current = pending.shift();
    if (current === undefined) break;
    for (const direction of directions) {
      const adjacent = {
        x: current.x + direction.x,
        y: current.y + direction.y,
      };
      const adjacentKey = key(adjacent);
      const tile = unique.get(adjacentKey);
      if (tile !== undefined && !visited.has(adjacentKey)) {
        visited.add(adjacentKey);
        pending.push(tile);
      }
    }
  }
  if (visited.size !== unique.size) return { outcome: "disconnected" };

  const xs = [...unique.values()].map(({ x }) => x);
  const ys = [...unique.values()].map(({ y }) => y);
  const minimumX = Math.min(...xs);
  const maximumX = Math.max(...xs);
  const minimumY = Math.min(...ys);
  const maximumY = Math.max(...ys);
  const width = maximumX - minimumX + 1;
  const height = maximumY - minimumY + 1;
  if (width * height !== unique.size) return { outcome: "non-rectangular" };

  return {
    outcome: "connected",
    surface: {
      height,
      origin: { x: minimumX, y: maximumY },
      tiles: [...unique.values()],
      width,
    },
  };
}

export function mapMonitorTouch(
  surface: MonitorSurface,
  tile: MonitorTile,
  localX: number,
  localY: number,
  cellsPerTile = { width: 17, height: 9 },
): MonitorTouch {
  if (
    !surface.tiles.some(({ x, y }) => x === tile.x && y === tile.y) ||
    localX < 0 ||
    localX >= 1 ||
    localY < 0 ||
    localY >= 1
  ) {
    return { outcome: "outside" };
  }
  return {
    outcome: "mapped",
    cell: {
      x:
        (tile.x - surface.origin.x) * cellsPerTile.width +
        Math.floor(localX * cellsPerTile.width) +
        1,
      y:
        (surface.origin.y - tile.y) * cellsPerTile.height +
        Math.min(
          cellsPerTile.height - 1,
          Math.floor((1 - localY) * cellsPerTile.height),
        ) +
        1,
    },
  };
}

export class BoundedMonitorUpdates {
  readonly #pending = new Map<string, MonitorUpdate>();

  constructor(readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError(
        "Monitor update capacity must be a positive integer.",
      );
    }
  }

  get size(): number {
    return this.#pending.size;
  }

  write(update: MonitorUpdate): "queued" | "coalesced" | "full" {
    const updateKey = key(update);
    if (this.#pending.has(updateKey)) {
      this.#pending.set(updateKey, update);
      return "coalesced";
    }
    if (this.#pending.size >= this.capacity) return "full";
    this.#pending.set(updateKey, update);
    return "queued";
  }

  flush(budget: number): MonitorFlush {
    const count = Math.max(0, Math.min(Math.floor(budget), this.#pending.size));
    const updates = [...this.#pending.values()].slice(0, count);
    for (const update of updates) this.#pending.delete(key(update));
    return { remaining: this.#pending.size, updates };
  }
}

function key(position: MonitorCell): string {
  return `${position.x},${position.y}`;
}
