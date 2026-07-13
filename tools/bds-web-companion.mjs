import { BdsDebugSession } from "./bds-debug-session.mjs";
import { WebCompanionServer } from "./web-companion-server.mjs";

const bds = new BdsDebugSession();
const web = new WebCompanionServer({
  bds,
  host: process.env.WEB_COMPANION_HOST ?? "127.0.0.1",
  port: process.env.WEB_COMPANION_PORT ?? "19144",
  publicHost: process.env.WEB_COMPANION_PUBLIC_HOST,
  publicOrigin: process.env.WEB_COMPANION_PUBLIC_ORIGIN,
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
    process.exit(code);
  }
}

function message(error) {
  return error instanceof Error ? error.message : String(error);
}
