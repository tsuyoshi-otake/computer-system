import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const localAppData = process.env.LOCALAPPDATA;

if (localAppData === undefined) {
  throw new Error(
    "LOCALAPPDATA is required to deploy Bedrock development packs.",
  );
}

const comMojang = path.join(
  localAppData,
  "Packages",
  "Microsoft.MinecraftUWP_8wekyb3d8bbwe",
  "LocalState",
  "games",
  "com.mojang",
);

const deployments = [
  {
    source: path.join(root, "dist", "behavior_pack"),
    target: path.join(
      comMojang,
      "development_behavior_packs",
      "computer_system_phase_0",
    ),
  },
  {
    source: path.join(root, "dist", "resource_pack"),
    target: path.join(
      comMojang,
      "development_resource_packs",
      "computer_system_phase_0",
    ),
  },
];

for (const deployment of deployments) {
  await rm(deployment.target, { force: true, recursive: true });
  await mkdir(path.dirname(deployment.target), { recursive: true });
  await cp(deployment.source, deployment.target, { recursive: true });
  console.log(`Deployed ${deployment.source} to ${deployment.target}`);
}
