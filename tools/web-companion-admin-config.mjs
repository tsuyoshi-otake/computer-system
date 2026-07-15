import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { normalizePublicOrigin } from "./web-companion-server.mjs";

const configurationVersion = 1;
const maximumConfigurationBytes = 16 * 1_024;
const allowedKeys = new Set(["version", "port", "publicOrigin"]);

export function defaultWebCompanionConfigPath(options = {}) {
  const platform = options.platform ?? process.platform;
  const environment = options.environment ?? process.env;
  if (Object.hasOwn(environment, "WEB_COMPANION_CONFIG_FILE")) {
    const configured = environment.WEB_COMPANION_CONFIG_FILE;
    return configured === "" ? undefined : path.resolve(configured);
  }
  if (platform === "win32") {
    const programData =
      environment.ProgramData ??
      environment.PROGRAMDATA ??
      environment.ALLUSERSPROFILE ??
      "C:\\ProgramData";
    return path.join(programData, "Computer System", "web-companion.json");
  }
  if (platform === "darwin") {
    return "/Library/Application Support/Computer System/web-companion.json";
  }
  return "/etc/computer-system/web-companion.json";
}

export async function loadWebCompanionAdminConfig(configPath) {
  if (configPath === undefined) return {};
  let source;
  try {
    source = await readFile(configPath);
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw new Error(
      `Unable to read Web companion configuration ${configPath}: ${message(error)}`,
    );
  }
  if (source.byteLength > maximumConfigurationBytes) {
    throw new Error(
      `Web companion configuration exceeds ${String(maximumConfigurationBytes)} bytes: ${configPath}`,
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(source.toString("utf8"));
  } catch (error) {
    throw new Error(
      `Web companion configuration is not valid JSON: ${message(error)}`,
    );
  }
  return validateWebCompanionAdminConfig(parsed);
}

export function validateWebCompanionAdminConfig(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Web companion configuration must be a JSON object.");
  }
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      throw new Error(`Unknown Web companion configuration field: ${key}`);
    }
  }
  if (value.version !== configurationVersion) {
    throw new Error(
      `Web companion configuration version must be ${String(configurationVersion)}.`,
    );
  }
  const validated = { version: configurationVersion };
  if (value.port !== undefined)
    validated.port = validatePersistentPort(value.port);
  if (value.publicOrigin !== undefined) {
    validated.publicOrigin = normalizePublicOrigin(value.publicOrigin);
  }
  return validated;
}

export async function saveWebCompanionAdminConfig(configPath, value) {
  if (configPath === undefined) {
    throw new Error(
      "Persistent Web companion configuration is disabled by WEB_COMPANION_CONFIG_FILE.",
    );
  }
  const validated = validateWebCompanionAdminConfig({
    version: configurationVersion,
    ...value,
  });
  await mkdir(path.dirname(configPath), { recursive: true });
  const temporaryPath = `${configPath}.${String(process.pid)}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(validated, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    await rename(temporaryPath, configPath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw new Error(
      `Unable to save Web companion configuration ${configPath}: ${message(error)}`,
    );
  }
  return validated;
}

export async function removeWebCompanionAdminConfig(configPath) {
  if (configPath === undefined) return false;
  try {
    await rm(configPath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw new Error(
      `Unable to remove Web companion configuration ${configPath}: ${message(error)}`,
    );
  }
}

export function resolveWebCompanionAdminOptions(environment, persisted) {
  return {
    port: environment.WEB_COMPANION_PORT ?? persisted.port ?? "80",
    publicOrigin:
      environment.WEB_COMPANION_PUBLIC_ORIGIN ?? persisted.publicOrigin,
  };
}

function validatePersistentPort(value) {
  const text = String(value);
  if (!/^\d+$/u.test(text)) {
    throw new RangeError("Persistent Web companion port must be an integer.");
  }
  const port = Number.parseInt(text, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65_534) {
    throw new RangeError(
      "Persistent Web companion port must be between 1 and 65534.",
    );
  }
  return port;
}

function message(error) {
  return error instanceof Error ? error.message : String(error);
}
