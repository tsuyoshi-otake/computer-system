#!/usr/bin/env node

import {
  defaultWebCompanionConfigPath,
  loadWebCompanionAdminConfig,
  removeWebCompanionAdminConfig,
  saveWebCompanionAdminConfig,
} from "./web-companion-admin-config.mjs";

try {
  const arguments_ = process.argv.slice(2);
  if (arguments_.length > 10) fail("Too many arguments.");
  const configFileIndex = arguments_.indexOf("--config-file");
  if (configFileIndex >= 0) {
    const configuredPath = arguments_[configFileIndex + 1];
    if (configuredPath === undefined || configuredPath.startsWith("--")) {
      fail("--config-file requires a path.");
    }
    arguments_.splice(configFileIndex, 2);
    process.env.WEB_COMPANION_CONFIG_FILE = configuredPath;
  }
  const configPath = defaultWebCompanionConfigPath();
  const command = arguments_.shift();
  if (command === "show") {
    requireNoArguments(arguments_);
    const configuration = await loadWebCompanionAdminConfig(configPath);
    print({ path: configPath ?? null, configuration });
  } else if (command === "set") {
    const current = await loadWebCompanionAdminConfig(configPath);
    const next = parseSetArguments(arguments_, current);
    const configuration = await saveWebCompanionAdminConfig(configPath, next);
    print({ path: configPath, configuration, restartRequired: true });
  } else if (command === "reset") {
    requireNoArguments(arguments_);
    const removed = await removeWebCompanionAdminConfig(configPath);
    print({ path: configPath ?? null, removed, restartRequired: removed });
  } else {
    fail(
      "Usage: npm run web:config -- <show|set|reset> [--port PORT] [--url ORIGIN] [--runtime-workers COUNT(1..16, default 2)] [--clear-port] [--clear-url] [--clear-runtime-workers (restore 2)] [--config-file PATH]",
    );
  }
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}

function parseSetArguments(arguments_, current) {
  const next = { ...current };
  let changed = false;
  while (arguments_.length > 0) {
    const option = arguments_.shift();
    if (
      option === "--port" ||
      option === "--url" ||
      option === "--runtime-workers"
    ) {
      const value = arguments_.shift();
      if (value === undefined || value.startsWith("--")) {
        fail(`${option} requires a value.`);
      }
      if (option === "--port") next.port = value;
      else if (option === "--url") next.publicOrigin = value;
      else next.runtimeWorkerCount = value;
      changed = true;
    } else if (option === "--clear-port") {
      delete next.port;
      changed = true;
    } else if (option === "--clear-url") {
      delete next.publicOrigin;
      changed = true;
    } else if (option === "--clear-runtime-workers") {
      delete next.runtimeWorkerCount;
      changed = true;
    } else {
      fail(`Unknown option: ${String(option)}`);
    }
  }
  if (!changed) fail("set requires at least one setting change.");
  return next;
}

function requireNoArguments(arguments_) {
  if (arguments_.length > 0) fail(`Unexpected argument: ${arguments_[0]}`);
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function fail(message) {
  throw new Error(message);
}
