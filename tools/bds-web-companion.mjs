import { BdsDebugSession } from "./bds-debug-session.mjs";
import {
  defaultWebCompanionConfigPath,
  loadWebCompanionAdminConfig,
  resolveWebCompanionAdminOptions,
} from "./web-companion-admin-config.mjs";
import {
  parseBooleanFlag,
  parseOptionalBooleanFlag,
  WebCompanionServer,
} from "./web-companion-server.mjs";

const bds = new BdsDebugSession();
const adminConfigPath = defaultWebCompanionConfigPath();
const persistedAdminConfig = await loadWebCompanionAdminConfig(adminConfigPath);
const adminOptions = resolveWebCompanionAdminOptions(
  process.env,
  persistedAdminConfig,
);
const stopMigrationLogForwarding = bds.onLog((entry) => {
  if (
    entry.line.includes("CS_STORAGE_MIGRATION") ||
    entry.line.includes("Computer System storage migration")
  ) {
    process.stdout.write(`${entry.line}\n`);
  }
});
const web = new WebCompanionServer({
  bds,
  host: process.env.WEB_COMPANION_HOST ?? "0.0.0.0",
  port: adminOptions.port,
  publicHost: process.env.WEB_COMPANION_PUBLIC_HOST,
  publicOrigin: adminOptions.publicOrigin,
  allowedOrigins: process.env.WEB_COMPANION_ALLOWED_ORIGINS,
  autoOpenBrowser: parseOptionalBooleanFlag(
    process.env.WEB_COMPANION_AUTO_OPEN ?? "1",
    "WEB_COMPANION_AUTO_OPEN",
  ),
  debugIgnoreRange: parseBooleanFlag(
    process.env.WEB_COMPANION_DEBUG_IGNORE_RANGE,
    "WEB_COMPANION_DEBUG_IGNORE_RANGE",
  ),
});
let shuttingDown = false;

process.on("SIGINT", () => void shutdown(0));
process.on("SIGTERM", () => void shutdown(0));

try {
  const webStatus = await web.start();
  const bdsStatus = await bds.start({ resetWorld: false });
  process.stdout.write(
    `${JSON.stringify({
      state: "running",
      minecraft: {
        address: bdsStatus.address,
        port: bdsStatus.port,
        world: bdsStatus.world,
      },
      web: webStatus,
      webConfiguration: {
        path: adminConfigPath ?? null,
        persisted: persistedAdminConfig,
        environmentOverrides: {
          port: process.env.WEB_COMPANION_PORT !== undefined,
          publicOrigin: process.env.WEB_COMPANION_PUBLIC_ORIGIN !== undefined,
        },
      },
    })}\n`,
  );
} catch (error) {
  process.stderr.write(
    `Unable to start BDS Web companion: ${message(error)}\n`,
  );
  await shutdown(1);
}

async function shutdown(exitCode) {
  if (shuttingDown) return;
  shuttingDown = true;
  let code = exitCode;
  try {
    await web.stop();
    await bds.stop();
  } catch (error) {
    code = 1;
    process.stderr.write(
      `BDS Web companion shutdown failed: ${message(error)}\n`,
    );
  } finally {
    stopMigrationLogForwarding();
    process.exit(code);
  }
}

function message(error) {
  return error instanceof Error ? error.message : String(error);
}
