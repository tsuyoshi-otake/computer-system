import { BdsDebugSession } from "./bds-debug-session.mjs";
import {
  parseBooleanFlag,
  parseOptionalBooleanFlag,
  WebCompanionServer,
} from "./web-companion-server.mjs";

const bds = new BdsDebugSession();
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
  port: process.env.WEB_COMPANION_PORT ?? "19144",
  publicHost: process.env.WEB_COMPANION_PUBLIC_HOST,
  publicOrigin: process.env.WEB_COMPANION_PUBLIC_ORIGIN,
  allowedOrigins: process.env.WEB_COMPANION_ALLOWED_ORIGINS,
  autoOpenBrowser: parseOptionalBooleanFlag(
    process.env.WEB_COMPANION_AUTO_OPEN,
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
