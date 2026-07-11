import { cp, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = path.join(root, "dist");
const behaviorOutput = path.join(outputRoot, "behavior_pack");
const resourceOutput = path.join(outputRoot, "resource_pack");

await rm(outputRoot, { force: true, recursive: true });
await mkdir(path.join(behaviorOutput, "scripts"), { recursive: true });

await Promise.all([
  cp(path.join(root, "packs", "behavior"), behaviorOutput, {
    recursive: true,
  }),
  cp(path.join(root, "packs", "resource"), resourceOutput, {
    recursive: true,
  }),
]);

await build({
  bundle: true,
  entryPoints: [path.join(root, "src", "bedrock", "main.ts")],
  external: ["@minecraft/server", "@minecraft/server-ui"],
  format: "esm",
  logLevel: "info",
  outfile: path.join(behaviorOutput, "scripts", "main.js"),
  platform: "neutral",
  sourcemap: true,
  target: "es2022",
});

for (const manifestPath of [
  path.join(behaviorOutput, "manifest.json"),
  path.join(resourceOutput, "manifest.json"),
]) {
  JSON.parse(await readFile(manifestPath, "utf8"));
}

console.log(`Built feasibility packs in ${outputRoot}`);
