import { Player, system, world } from "@minecraft/server";

import { startHeadlessProbeSuite } from "./probes/headlessProbe.js";
import { startRuntimeProbe } from "./probes/runtimeProbe.js";
import { runStorageProbe } from "./probes/storageProbe.js";
import { showTerminalProbe } from "./probes/uiProbe.js";

const packVersion = "0.1.0";

system.run((): void => {
  world.sendMessage(`Computer System Phase 0 loaded (${packVersion}).`);
});

system.afterEvents.scriptEventReceive.subscribe((event): void => {
  if (event.id !== "computer_system:probe") {
    return;
  }

  const command = event.message.trim().toLowerCase() || "status";
  if (command === "headless") {
    startHeadlessProbeSuite();
    return;
  }

  if (!(event.sourceEntity instanceof Player)) {
    world.sendMessage("Computer System probes must be run by a player.");
    return;
  }

  switch (command) {
    case "help":
    case "status":
      event.sourceEntity.sendMessage(
        "Computer System Phase 0 commands: status, ui, runtime, storage, headless",
      );
      return;
    case "runtime":
      startRuntimeProbe(event.sourceEntity);
      return;
    case "storage":
      runStorageProbe(event.sourceEntity);
      return;
    case "ui":
      void showTerminalProbe(event.sourceEntity);
      return;
    default:
      event.sourceEntity.sendMessage(
        `Unknown Computer System probe: ${command}`,
      );
  }
});
