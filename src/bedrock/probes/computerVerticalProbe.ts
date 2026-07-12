import { world } from "@minecraft/server";

import { DynamicPropertyComputerRepository } from "../../adapters/storage/dynamicPropertyComputerRepository.js";
import { DynamicPropertyIdentityRepository } from "../../adapters/storage/dynamicPropertyIdentityRepository.js";
import {
  runVerticalSliceProbe,
  type VerticalSliceProbeResult,
} from "../../application/computer/verticalSliceProbe.js";

export function executeComputerVerticalProbe(): VerticalSliceProbeResult {
  return runVerticalSliceProbe(
    new DynamicPropertyIdentityRepository(world),
    new DynamicPropertyComputerRepository(world),
  );
}
