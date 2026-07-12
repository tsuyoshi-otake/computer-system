import { Player, system, world } from "@minecraft/server";

import { startComputerHost } from "./computerHost.js";
import {
  registerComputerComponents,
  startComputerComponents,
} from "./computerComponent.js";

import {
  placeMonitorProbe,
  registerMonitorComponent,
} from "./monitorComponent.js";
import {
  givePocketComputer,
  registerPocketComputerComponent,
  startPocketComputerLifecycle,
} from "./pocketComputer.js";
import { startHeadlessProbeSuite } from "./probes/headlessProbe.js";
import { registerRedstoneProbeComponent } from "./probes/redstoneProbeComponent.js";
import { startRuntimeProbe } from "./probes/runtimeProbe.js";
import { executeSpeakerProbe } from "./probes/speakerProbe.js";
import { runStorageProbe } from "./probes/storageProbe.js";
import {
  showTerminalProbe,
  startTerminalCompetitionProbe,
  startTerminalStreamProbe,
} from "./probes/uiProbe.js";

const packVersion = "0.1.0";

system.beforeEvents.startup.subscribe(
  ({ blockComponentRegistry, itemComponentRegistry }): void => {
    registerComputerComponents(blockComponentRegistry, itemComponentRegistry);
    registerRedstoneProbeComponent(blockComponentRegistry);
    registerMonitorComponent(blockComponentRegistry);
    registerPocketComputerComponent(itemComponentRegistry);
  },
);

system.run((): void => {
  startComputerHost();
  startComputerComponents();
  startPocketComputerLifecycle();
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
        "Computer System Phase 0 commands: status, ui, stream, compete, monitor, pocket, runtime, storage, speaker, headless",
      );
      return;
    case "runtime":
      startRuntimeProbe(event.sourceEntity);
      return;
    case "storage":
      runStorageProbe(event.sourceEntity);
      return;
    case "speaker": {
      const result = executeSpeakerProbe(
        event.sourceEntity.dimension,
        event.sourceEntity.location,
      );
      event.sourceEntity.sendMessage(
        `Speaker probe issued ${result.calls} notes at pitches ${result.pitches}.`,
      );
      return;
    }
    case "ui": {
      const player = event.sourceEntity;
      system.run((): void => {
        void showTerminalProbe(player);
      });
      return;
    }
    case "compete": {
      const player = event.sourceEntity;
      system.run((): void => startTerminalCompetitionProbe(player));
      return;
    }
    case "stream": {
      const player = event.sourceEntity;
      system.run((): void => startTerminalStreamProbe(player));
      return;
    }
    case "pocket": {
      const player = event.sourceEntity;
      system.run((): void => {
        try {
          const identity = givePocketComputer(player);
          player.sendMessage(`Pocket Computer granted (${identity}).`);
        } catch (error: unknown) {
          if (player.isValid)
            player.sendMessage(
              `Pocket Computer grant failed: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
      });
      return;
    }
    case "monitor":
      placeMonitorProbe(event.sourceEntity);
      return;
    default:
      event.sourceEntity.sendMessage(
        `Unknown Computer System probe: ${command}`,
      );
  }
});
