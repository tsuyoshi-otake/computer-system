import type {
  BlockComponentRegistry,
  BlockCustomComponent,
  Vector3,
} from "@minecraft/server";

interface RedstoneEventRecord {
  readonly location: Vector3;
  readonly powerLevel: number;
  readonly previousPowerLevel: number;
}

const records: RedstoneEventRecord[] = [];
const maximumRecords = 128;

const component: BlockCustomComponent = {
  onRedstoneUpdate(event): void {
    records.push({
      location: event.block.location,
      powerLevel: event.powerLevel,
      previousPowerLevel: event.previousPowerLevel,
    });
    if (records.length > maximumRecords) {
      records.splice(0, records.length - maximumRecords);
    }
  },
};

export function registerRedstoneProbeComponent(
  registry: BlockComponentRegistry,
): void {
  registry.registerCustomComponent("computer_system:redstone_probe", component);
}

export function resetRedstoneProbeEvents(): void {
  records.length = 0;
}

export function readRedstoneProbeEvents(): readonly RedstoneEventRecord[] {
  return records;
}
