import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Builds the gated Issue #106 CS486 wasm batch-executor prototype artifacts
 * (Rust and AssemblyScript variants) into `wasm/dist/`. Host tooling only:
 * the artifacts never ship in the Bedrock pack and are never committed.
 *
 * Preflight fails fast with actionable instructions when the optional
 * toolchains are missing; `npm run validate` never depends on this script.
 *
 * `--check` rebuilds both variants into a temporary directory and verifies
 * the SHA-256 of each rebuilt artifact matches `wasm/dist/`, proving the
 * build is deterministic on this machine.
 */
const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const rustCrateDirectory = path.join(
  repositoryRoot,
  "wasm",
  "cs486-batch-executor-rs",
);
const asProjectDirectory = path.join(
  repositoryRoot,
  "wasm",
  "cs486-batch-executor-as",
);
const distDirectory = path.join(repositoryRoot, "wasm", "dist");
const rustArtifactName = "cs486-batch-executor.rust.wasm";
const asArtifactName = "cs486-batch-executor.as.wasm";
const checksumFileName = "SHA256SUMS.txt";

// cargo/rustup/npx resolve through .cmd shims on Windows, so commands need a
// shell there; arguments below are fixed strings, never user input.
const useShell = process.platform === "win32";

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: "utf8",
    shell: useShell,
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
}

function preflight() {
  let installedTargets;
  try {
    installedTargets = run("rustup", ["target", "list", "--installed"]);
  } catch (error) {
    throw new Error(
      `rustup is required to build the Rust wasm variant; install rustup and run "rustup target add wasm32-unknown-unknown" (${describeError(error)})`,
    );
  }
  if (!installedTargets.includes("wasm32-unknown-unknown"))
    throw new Error(
      'missing Rust target wasm32-unknown-unknown; run "rustup target add wasm32-unknown-unknown"',
    );
  try {
    run("npx", ["--no-install", "asc", "--version"], {
      cwd: repositoryRoot,
    });
  } catch (error) {
    throw new Error(
      `the assemblyscript compiler is required; run "npm install" so the devDependency is available (${describeError(error)})`,
    );
  }
}

function buildRust(targetDirectory) {
  run("cargo", ["build", "--release", "--target", "wasm32-unknown-unknown"], {
    cwd: rustCrateDirectory,
    env: { ...process.env, CARGO_TARGET_DIR: targetDirectory },
    stdio: ["ignore", "inherit", "inherit"],
  });
  return path.join(
    targetDirectory,
    "wasm32-unknown-unknown",
    "release",
    "cs486_batch_executor_rs.wasm",
  );
}

function buildAssemblyScript(outFile) {
  run(
    "npx",
    [
      "--no-install",
      "asc",
      "--config",
      "asconfig.json",
      "--target",
      "release",
      "--outFile",
      outFile,
    ],
    {
      cwd: asProjectDirectory,
      stdio: ["ignore", "inherit", "inherit"],
    },
  );
  return outFile;
}

function sha256(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function buildInto(outputDirectory, cargoTargetDirectory) {
  mkdirSync(outputDirectory, { recursive: true });
  const rustBuilt = buildRust(cargoTargetDirectory);
  const rustOut = path.join(outputDirectory, rustArtifactName);
  copyFileSync(rustBuilt, rustOut);
  const asOut = buildAssemblyScript(path.join(outputDirectory, asArtifactName));
  return {
    [asArtifactName]: sha256(asOut),
    [rustArtifactName]: sha256(rustOut),
  };
}

function main() {
  const check = process.argv.includes("--check");
  preflight();

  const distHashes = buildInto(
    distDirectory,
    path.join(rustCrateDirectory, "target"),
  );
  const checksumLines = Object.entries(distHashes)
    .map(([name, hash]) => `${hash}  ${name}`)
    .join("\n");
  writeFileSync(
    path.join(distDirectory, checksumFileName),
    `${checksumLines}\n`,
  );
  process.stdout.write(`built wasm/dist artifacts:\n${checksumLines}\n`);

  if (!check) return;
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), "cs486-wasm-check-"));
  try {
    const rebuiltHashes = buildInto(
      path.join(temporaryRoot, "dist"),
      path.join(temporaryRoot, "cargo-target"),
    );
    for (const [name, hash] of Object.entries(distHashes)) {
      if (rebuiltHashes[name] !== hash)
        throw new Error(
          `non-deterministic build for ${name}: dist ${hash} != rebuilt ${rebuiltHashes[name]}`,
        );
    }
    process.stdout.write(
      "check OK: temporary rebuild reproduced identical SHA-256 hashes\n",
    );
  } finally {
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
}

function describeError(error) {
  return error instanceof Error ? error.message : String(error);
}

try {
  main();
} catch (error) {
  process.stderr.write(`build-cs486-wasm failed: ${describeError(error)}\n`);
  process.exitCode = 1;
}
