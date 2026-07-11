import { type Player, world } from "@minecraft/server";

const storageProbeKey = "computer_system:phase0_storage_probe";

interface StorageProbeRecord {
  readonly playerId: string;
  readonly sequence: number;
  readonly writtenAtTick: number;
}

export interface StorageProbeResult {
  readonly passed: boolean;
  readonly previousSequence: number;
  readonly sequence: number;
  readonly totalDynamicPropertyBytes: number;
}

export function runStorageProbe(player: Player): void {
  const result = executeStorageProbe(player.id);
  player.sendMessage(
    `Storage probe ${result.passed ? "PASS" : "FAIL"}: sequence=${result.sequence}, totalDynamicPropertyBytes=${result.totalDynamicPropertyBytes}.`,
  );
}

export function executeStorageProbe(playerId: string): StorageProbeResult {
  const previous = readRecord();
  const next: StorageProbeRecord = {
    playerId,
    sequence: (previous?.sequence ?? 0) + 1,
    writtenAtTick: world.getAbsoluteTime(),
  };

  world.setDynamicProperty(storageProbeKey, JSON.stringify(next));
  const loaded = readRecord();
  return {
    passed:
      loaded?.playerId === next.playerId &&
      loaded.sequence === next.sequence &&
      loaded.writtenAtTick === next.writtenAtTick,
    previousSequence: previous?.sequence ?? 0,
    sequence: next.sequence,
    totalDynamicPropertyBytes: world.getDynamicPropertyTotalByteCount(),
  };
}

function readRecord(): StorageProbeRecord | undefined {
  const value = world.getDynamicProperty(storageProbeKey);
  if (typeof value !== "string") {
    return undefined;
  }

  const parsed: unknown = JSON.parse(value);
  if (typeof parsed !== "object" || parsed === null) {
    return undefined;
  }

  const record = parsed as Partial<StorageProbeRecord>;
  if (
    typeof record.playerId !== "string" ||
    typeof record.sequence !== "number" ||
    typeof record.writtenAtTick !== "number"
  ) {
    return undefined;
  }

  return {
    playerId: record.playerId,
    sequence: record.sequence,
    writtenAtTick: record.writtenAtTick,
  };
}
