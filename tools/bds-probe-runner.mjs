import { spawn } from "node:child_process";
import {
  access,
  cp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const probeLogPrefix = "CS_PROBE_RESULT ";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distributionRoot = process.env.BDS_HOME;
const worldName = "ComputerSystemPhase0";

if (distributionRoot === undefined) {
  throw new Error(
    "BDS_HOME must point to an extracted official Bedrock Dedicated Server distribution.",
  );
}

const executableName =
  process.platform === "win32" ? "bedrock_server.exe" : "bedrock_server";
const sourceRoot = path.resolve(distributionRoot);
const executableSource = path.join(sourceRoot, executableName);
await access(executableSource);

const defaultWorkRoot = path.join(
  os.homedir(),
  "tmp",
  "computer-system-bds",
  String(Date.now()),
);
const workRoot = path.resolve(process.env.BDS_WORKDIR ?? defaultWorkRoot);

if (isWithin(workRoot, sourceRoot) || workRoot === sourceRoot) {
  throw new Error("BDS_WORKDIR must not be inside BDS_HOME.");
}

await ensureEmptyDirectory(workRoot);
await cp(sourceRoot, workRoot, { recursive: true });
await rm(path.join(workRoot, "worlds", worldName), {
  force: true,
  recursive: true,
});
await configureServer(workRoot);

console.log(`Preparing isolated Bedrock Dedicated Server at ${workRoot}`);
await runServer(workRoot, "generate");
await installWorldPacks(workRoot);

const first = await runServer(workRoot, "probe");
const second = await runServer(workRoot, "probe");
const bundle = await stat(
  path.join(root, "dist", "behavior_pack", "scripts", "main.js"),
);
const summary = verifySessions(first, second, bundle.size);

console.log(
  JSON.stringify(
    {
      status: "PASS",
      workRoot,
      ...summary,
    },
    null,
    2,
  ),
);

function isWithin(candidate, parent) {
  const relative = path.relative(parent, candidate);
  return (
    relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
  );
}

async function ensureEmptyDirectory(directory) {
  await mkdir(directory, { recursive: true });
  const entries = await readdir(directory);
  if (entries.length !== 0) {
    throw new Error(`BDS_WORKDIR must be empty: ${directory}`);
  }
}

async function configureServer(serverRoot) {
  const propertiesPath = path.join(serverRoot, "server.properties");
  let properties = await readFile(propertiesPath, "utf8");
  const basePort = 20_000 + (process.pid % 20_000);
  const overrides = {
    "allow-cheats": "true",
    "allow-list": "true",
    "content-log-file-enabled": "true",
    "content-log-console-output-enabled": "true",
    "default-player-permission-level": "operator",
    "level-name": worldName,
    "online-mode": "true",
    "server-name": "Computer System Phase 0",
    "server-port": String(basePort),
    "server-portv6": String(basePort + 1),
  };

  for (const [key, value] of Object.entries(overrides)) {
    const pattern = new RegExp(`^${escapeRegExp(key)}=.*$`, "m");
    properties = pattern.test(properties)
      ? properties.replace(pattern, `${key}=${value}`)
      : `${properties.trimEnd()}\n${key}=${value}\n`;
  }

  await writeFile(propertiesPath, properties, "utf8");
}

async function installWorldPacks(serverRoot) {
  const worldRoot = path.join(serverRoot, "worlds", worldName);
  await access(worldRoot);

  const behaviorTarget = path.join(
    worldRoot,
    "behavior_packs",
    "computer_system_phase_0",
  );
  const resourceTarget = path.join(
    worldRoot,
    "resource_packs",
    "computer_system_phase_0",
  );
  await mkdir(path.dirname(behaviorTarget), { recursive: true });
  await mkdir(path.dirname(resourceTarget), { recursive: true });
  await cp(path.join(root, "dist", "behavior_pack"), behaviorTarget, {
    recursive: true,
  });
  await cp(path.join(root, "dist", "resource_pack"), resourceTarget, {
    recursive: true,
  });

  await writeFile(
    path.join(worldRoot, "world_behavior_packs.json"),
    `${JSON.stringify(
      [
        {
          pack_id: "c2a57113-2d13-4006-bdda-2cec5b99ae8c",
          version: [0, 1, 0],
        },
      ],
      null,
      2,
    )}\n`,
    "utf8",
  );
  await writeFile(
    path.join(worldRoot, "world_resource_packs.json"),
    `${JSON.stringify(
      [
        {
          pack_id: "ad53eb5b-6854-4977-b9d8-b45d7ccc29ba",
          version: [0, 1, 0],
        },
      ],
      null,
      2,
    )}\n`,
    "utf8",
  );
}

function runServer(serverRoot, mode) {
  return new Promise((resolve, reject) => {
    const executable = path.join(serverRoot, executableName);
    const child = spawn(executable, [], {
      cwd: serverRoot,
      env:
        process.platform === "linux"
          ? { ...process.env, LD_LIBRARY_PATH: serverRoot }
          : process.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const records = [];
    const memoryWarningLines = [];
    const recentLines = [];
    let buffer = "";
    let ready = false;
    let terminalObserved = false;
    let stopSent = false;
    let diagnosticContinuation = 0;

    const timeout = setTimeout(() => {
      requestStop();
      setTimeout(() => child.kill(), 5_000).unref();
      reject(
        new Error(
          `Bedrock Dedicated Server ${mode} session timed out. Recent output:\n${recentLines.join("\n")}`,
        ),
      );
    }, 90_000);

    function requestStop() {
      if (stopSent || child.stdin.destroyed) {
        return;
      }
      stopSent = true;
      child.stdin.write("stop\n");
    }

    function consume(chunk) {
      buffer += chunk.toString();
      const lines = buffer.split(/\r?\n/u);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        recentLines.push(line);
        if (recentLines.length > 80) {
          recentLines.shift();
        }

        if (
          /\[(?:Blocks|Item|Items|Json|Scripting)\].*(?:error|warning)/iu.test(
            line,
          )
        ) {
          console.error(`BDS_DIAGNOSTIC ${line}`);
          diagnosticContinuation = 4;
        } else if (diagnosticContinuation > 0 && line.trim() !== "") {
          console.error(`BDS_DIAGNOSTIC ${line}`);
          diagnosticContinuation -= 1;
        }

        if (isMemoryWarningSignal(line)) {
          memoryWarningLines.push(line);
        }

        if (!ready && /Server started/u.test(line)) {
          ready = true;
          if (mode === "generate") {
            requestStop();
          } else {
            setTimeout(() => {
              child.stdin.write("scriptevent computer_system:probe headless\n");
            }, 1_000);
          }
        }

        const prefixIndex = line.indexOf(probeLogPrefix);
        if (prefixIndex === -1) {
          continue;
        }

        let record;
        try {
          record = JSON.parse(
            line.slice(prefixIndex + probeLogPrefix.length).trim(),
          );
        } catch (error) {
          requestStop();
          reject(
            new Error(
              `Invalid probe record: ${error instanceof Error ? error.message : String(error)}`,
            ),
          );
          continue;
        }
        records.push(record);
        console.log(`${probeLogPrefix}${JSON.stringify(record)}`);
        if (
          record.probe === "suite" &&
          (record.details?.phase === "complete" ||
            record.details?.phase === "exception")
        ) {
          terminalObserved = true;
          requestStop();
        }
      }
    }

    child.stdout.on("data", consume);
    child.stderr.on("data", consume);
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (!ready) {
        reject(
          new Error(
            `Bedrock Dedicated Server exited before readiness (code ${String(code)}). Recent output:\n${recentLines.join("\n")}`,
          ),
        );
        return;
      }
      if (mode === "probe" && !terminalObserved) {
        reject(
          new Error(
            `Probe session exited without a terminal suite record (code ${String(code)}). Recent output:\n${recentLines.join("\n")}`,
          ),
        );
        return;
      }
      resolve({ records, memoryWarningLines });
    });
  });
}

function verifySessions(first, second, bundleBytes) {
  const firstStorage = requirePassingRecord(first.records, "storage");
  const firstRuntime = requirePassingRecord(first.records, "runtime");
  const firstTurtle = requirePassingRecord(first.records, "turtle");
  const firstIdentity = requirePassingRecord(first.records, "item_identity");
  const firstMonitor = requirePassingRecord(first.records, "monitor");
  const firstSpeaker = requirePassingRecord(first.records, "speaker");
  const firstRedstone = requirePassingRecord(first.records, "redstone");
  const firstComputer = requirePassingRecord(
    first.records,
    "computer_vertical",
  );
  const secondStorage = requirePassingRecord(second.records, "storage");
  const secondRuntime = requirePassingRecord(second.records, "runtime");
  const secondTurtle = requirePassingRecord(second.records, "turtle");
  const secondIdentity = requirePassingRecord(second.records, "item_identity");
  const secondMonitor = requirePassingRecord(second.records, "monitor");
  const secondSpeaker = requirePassingRecord(second.records, "speaker");
  const secondRedstone = requirePassingRecord(second.records, "redstone");
  const secondComputer = requirePassingRecord(
    second.records,
    "computer_vertical",
  );
  requirePassingRecord(first.records, "suite", "complete");
  requirePassingRecord(second.records, "suite", "complete");

  if (firstRuntime.details.minimum !== 2_000) {
    throw new Error("First runtime probe minimum was not 2000.");
  }
  if (firstRuntime.details.maximum !== 2_000) {
    throw new Error("First runtime probe maximum was not 2000.");
  }
  if (secondRuntime.details.minimum !== 2_000) {
    throw new Error("Second runtime probe minimum was not 2000.");
  }
  if (secondRuntime.details.maximum !== 2_000) {
    throw new Error("Second runtime probe maximum was not 2000.");
  }
  for (const [name, session, runtime] of [
    ["first", first, firstRuntime],
    ["second", second, secondRuntime],
  ]) {
    if (
      runtime.details.withinTickBudget !== true ||
      typeof runtime.details.maximumTickDurationMs !== "number" ||
      typeof runtime.details.averageTickDurationMs !== "number" ||
      runtime.details.maximumTickDurationMs > runtime.details.tickBudgetMs
    ) {
      throw new Error(`${name} runtime probe exceeded its tick budget.`);
    }
    if (session.memoryWarningLines.length !== 0) {
      throw new Error(
        `${name} session emitted memory warning signals: ${session.memoryWarningLines.join(" | ")}`,
      );
    }
  }
  if (secondStorage.details.sequence !== firstStorage.details.sequence + 1) {
    throw new Error(
      "Dynamic Property sequence did not persist across restart.",
    );
  }
  for (const [name, record, loadedSnapshot] of [
    ["first computer", firstComputer, false],
    ["second computer", secondComputer, true],
  ]) {
    if (
      record.details.identityStable !== true ||
      record.details.loadedSnapshot !== loadedSnapshot ||
      record.details.outputMask !== 2 ||
      record.details.startupPresent !== true ||
      record.details.terminatedOff !== true
    ) {
      throw new Error(`${name} did not verify the Phase 2 vertical slice.`);
    }
  }
  if (firstIdentity.details.previousIdentityPresent !== false) {
    throw new Error("First session unexpectedly found an identity item.");
  }
  if (secondIdentity.details.previousIdentityPresent !== true) {
    throw new Error("Item identity did not persist across restart.");
  }
  for (const [name, record] of [
    ["first identity", firstIdentity],
    ["second identity", secondIdentity],
  ]) {
    for (const detail of [
      "droppedIdentityPreserved",
      "placedIdentityPreserved",
      "roundTripIdentityPreserved",
      "storedIdentityPreserved",
    ]) {
      if (record.details[detail] !== true) {
        throw new Error(`${name} did not verify ${detail}.`);
      }
    }
  }

  for (const [name, record] of [
    ["first monitor", firstMonitor],
    ["second monitor", secondMonitor],
  ]) {
    if (
      record.details.tilesDiscovered !== 6 ||
      record.details.cellsWide !== 51 ||
      record.details.cellsHigh !== 18 ||
      record.details.coalescedUpdate !== true ||
      record.details.flushBudgetRespected !== true
    ) {
      throw new Error(`${name} did not verify the bounded 3x2 surface.`);
    }
  }

  for (const [name, record] of [
    ["first turtle", firstTurtle],
    ["second turtle", secondTurtle],
  ]) {
    for (const detail of [
      "successfulMove",
      "blockedMoveRejected",
      "conflictRejected",
      "unloadedMoveRejected",
      "rollbackRestored",
      "dropRecovered",
      "inventoryTransferred",
      "representativeBlockBroken",
      "representativeBlockInspected",
      "representativeBlockPlaced",
    ]) {
      if (record.details[detail] !== true) {
        throw new Error(`${name} did not verify ${detail}.`);
      }
    }
  }

  for (const [name, record] of [
    ["first redstone", firstRedstone],
    ["second redstone", secondRedstone],
  ]) {
    if (record.details.inputFacesVerified !== 6) {
      throw new Error(`${name} did not verify six input faces.`);
    }
    if (record.details.digitalMasksVerified !== 64) {
      throw new Error(`${name} did not verify 64 output masks.`);
    }
    if (record.details.analogLevelsVerified !== 16) {
      throw new Error(`${name} did not verify 16 analog levels.`);
    }
    if (record.details.simultaneousAnalogOutputs !== true) {
      throw new Error(`${name} did not verify independent analog outputs.`);
    }
  }

  if (firstSpeaker.details.calls !== 2 || secondSpeaker.details.calls !== 2) {
    throw new Error("Speaker probe did not issue both pitched sound calls.");
  }

  return {
    bundleBytes,
    firstAverageTickDurationMs: firstRuntime.details.averageTickDurationMs,
    firstMaximumTickDurationMs: firstRuntime.details.maximumTickDurationMs,
    secondAverageTickDurationMs: secondRuntime.details.averageTickDurationMs,
    secondMaximumTickDurationMs: secondRuntime.details.maximumTickDurationMs,
    tickBudgetMs: secondRuntime.details.tickBudgetMs,
    memoryWarningSignals: 0,
    firstStorageSequence: firstStorage.details.sequence,
    secondStorageSequence: secondStorage.details.sequence,
    runtimeMinimum: secondRuntime.details.minimum,
    runtimeMaximum: secondRuntime.details.maximum,
    itemIdentityPersisted: secondIdentity.details.previousIdentityPresent,
    computerSnapshotPersisted: secondComputer.details.loadedSnapshot,
    monitorTiles: secondMonitor.details.tilesDiscovered,
    monitorCells: `${String(secondMonitor.details.cellsWide)}x${String(secondMonitor.details.cellsHigh)}`,
    redstoneInputFaces: secondRedstone.details.inputFacesVerified,
    redstoneOutputMasks: secondRedstone.details.digitalMasksVerified,
    redstoneAnalogLevels: secondRedstone.details.analogLevelsVerified,
    turtleConflictRejected: secondTurtle.details.conflictRejected,
    turtleUnloadedMoveRejected: secondTurtle.details.unloadedMoveRejected,
  };
}

function isMemoryWarningSignal(line) {
  return /(?:allocation failed|low memory|memory (?:pressure|warning)|out of memory|watchdog termination)/iu.test(
    line,
  );
}

function requirePassingRecord(records, probe, phase) {
  const record = records.find(
    (candidate) =>
      candidate.probe === probe &&
      (phase === undefined || candidate.details?.phase === phase),
  );
  if (record === undefined) {
    throw new Error(
      `Missing ${probe}${phase === undefined ? "" : `/${phase}`} record.`,
    );
  }
  if (record.status !== "PASS") {
    throw new Error(`${probe} probe ended with ${String(record.status)}.`);
  }
  return record;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
