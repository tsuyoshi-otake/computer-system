import { Player, system, world } from "@minecraft/server";

import { startAlwaysDayController } from "./daylightController.js";
import {
  startComputerHost,
  startComputerStorageBootstrap,
} from "./computerHost.js";
import {
  desktopComputerDisplayName,
  giveNewComputerItem,
  registerComputerComponents,
  startComputerComponents,
} from "./computerComponent.js";

import {
  placeMonitorProbe,
  registerMonitorComponent,
} from "./monitorComponent.js";
import {
  givePortableComputer,
  portableComputerDisplayName,
  registerPortableComputerComponent,
  startPortableComputerLifecycle,
} from "./portableComputer.js";
import { handleDebugCommand } from "./debugCommandBridge.js";
import { startComputerStorageBreakGuard } from "./computerRegistry.js";
import { handleDebugWebSessionRequest } from "./debugWebSessionBridge.js";
import { startHeadlessProbeSuite } from "./probes/headlessProbe.js";
import { registerRedstoneProbeComponent } from "./probes/redstoneProbeComponent.js";
import { startRuntimeProbe } from "./probes/runtimeProbe.js";
import { executeSpeakerProbe } from "./probes/speakerProbe.js";
import { runStorageProbe } from "./probes/storageProbe.js";
import {
  showCustomTerminalProbe,
  showNanoProbe,
  showTerminalProbe,
  startTerminalCompetitionProbe,
  startTerminalStreamProbe,
} from "./probes/uiProbe.js";
import {
  handleWebTerminalScriptEvent,
  startWebTerminalBridge,
} from "./webTerminalBridge.js";

const packVersion = "0.1.0";

system.beforeEvents.startup.subscribe(
  ({ blockComponentRegistry, itemComponentRegistry }): void => {
    registerComputerComponents(blockComponentRegistry, itemComponentRegistry);
    registerRedstoneProbeComponent(blockComponentRegistry);
    registerMonitorComponent(blockComponentRegistry);
    registerPortableComputerComponent(
      itemComponentRegistry,
      blockComponentRegistry,
    );
  },
);

system.run((): void => {
  startAlwaysDayController();
  startComputerStorageBreakGuard();
  startComputerHost();
  startComputerStorageBootstrap((): void => {
    startComputerComponents();
    startPortableComputerLifecycle();
    startWebTerminalBridge();
    world.sendMessage(`Computer System Phase 0 loaded (${packVersion}).`);
  });
});

system.afterEvents.scriptEventReceive.subscribe((event): void => {
  if (handleWebTerminalScriptEvent(event.id, event.message)) return;
  if (event.id === "computer_system:debug-command") {
    handleDebugCommand(event.message);
    return;
  }
  if (event.id === "computer_system:debug-web-request") {
    handleDebugWebSessionRequest(event.message);
    return;
  }
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
        "Computer System Phase 0 commands: status, ui, ui-custom, ui-nano, stream, compete, computer, monitor, portable, runtime, storage, speaker, headless",
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
    case "ui-custom": {
      const player = event.sourceEntity;
      system.run((): void => showCustomTerminalProbe(player));
      return;
    }
    case "ui-nano": {
      const player = event.sourceEntity;
      system.run((): void => showNanoProbe(player));
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
    case "portable": {
      const player = event.sourceEntity;
      system.run((): void => {
        try {
          const identity = givePortableComputer(player);
          player.sendMessage(
            `${portableComputerDisplayName} granted (${identity}).`,
          );
        } catch (error: unknown) {
          if (player.isValid)
            player.sendMessage(
              `${portableComputerDisplayName} grant failed: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
      });
      return;
    }
    case "computer": {
      const player = event.sourceEntity;
      system.run((): void => {
        try {
          giveNewComputerItem(player);
          if (player.isValid)
            player.sendMessage(`${desktopComputerDisplayName} granted.`);
        } catch (error: unknown) {
          if (player.isValid)
            player.sendMessage(
              `${desktopComputerDisplayName} grant failed: ${error instanceof Error ? error.message : String(error)}`,
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
