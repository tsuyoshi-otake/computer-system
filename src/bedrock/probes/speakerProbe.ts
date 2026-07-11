import type { Dimension, Vector3 } from "@minecraft/server";

import { probeArenaY } from "./worldProbeSupport.js";

export interface SpeakerProbeResult {
  readonly calls: number;
  readonly manualAudibilityRequired: boolean;
  readonly pitches: string;
}

export function executeSpeakerProbe(
  dimension: Dimension,
  location: Vector3 = { x: 0, y: probeArenaY, z: 0 },
): SpeakerProbeResult {
  const pitches = [0.5, 2];
  for (const pitch of pitches) {
    dimension.playSound("note.pling", location, { pitch, volume: 1 });
  }

  return {
    calls: pitches.length,
    manualAudibilityRequired: true,
    pitches: pitches.join(","),
  };
}
