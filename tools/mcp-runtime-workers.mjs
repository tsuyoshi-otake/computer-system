import { defaultCs486ComputeEngine } from "./cs486-compute-engine.mjs";
import { maximumRuntimeWorkerCount } from "./web-companion-admin-config.mjs";

export const mcpRuntimeWorkerCountVariable = "BDS_MCP_RUNTIME_WORKERS";

/**
 * Decides whether an MCP debug session routes guest CPU work to the managed
 * CS486 compute workers.
 *
 * MCP debugging defaults to the in-engine `Cs486Process`, so an ordinary
 * session starts no worker threads and no loopback listener. Setting
 * `BDS_MCP_RUNTIME_WORKERS` opts in to the same compute plane `dev:bds:web`
 * uses, which is what makes a non-default engine selection reach guest
 * execution at all.
 *
 * Selecting a non-default engine while the workers stay disabled is rejected
 * here rather than quietly ignored: the operator asked for an engine this shape
 * of session cannot run, and silently interpreting guest work with a different
 * engine would turn the resulting evidence into a lie. Issue #115 left one
 * engine name, so nothing can select a second one today; the rule stays because
 * it is about the shape of the session, not about which engines exist.
 *
 * @returns the validated worker count, or `undefined` when the session keeps
 * the in-engine CPU.
 */
export function resolveMcpRuntimeWorkerCount(
  environment = {},
  adminOptions = {},
) {
  const workerCount = parseWorkerCount(
    environment[mcpRuntimeWorkerCountVariable],
  );
  const cpuEngine = adminOptions.cpuEngine ?? defaultCs486ComputeEngine;
  if (workerCount === undefined && cpuEngine !== defaultCs486ComputeEngine) {
    throw new Error(
      `The MCP debug server runs the in-engine ${defaultCs486ComputeEngine} CS486 CPU unless ${mcpRuntimeWorkerCountVariable} enables the managed compute workers, so the selected ${cpuEngine} engine would never execute guest work. Set ${mcpRuntimeWorkerCountVariable} to an integer between 1 and ${String(maximumRuntimeWorkerCount)}, or select the ${defaultCs486ComputeEngine} engine.`,
    );
  }
  return workerCount;
}

function parseWorkerCount(value) {
  if (value === undefined || value === "") return undefined;
  const invalid = () =>
    new RangeError(
      `${mcpRuntimeWorkerCountVariable} must be 0 to keep the in-engine CS486 CPU or an integer between 1 and ${String(maximumRuntimeWorkerCount)}.`,
    );
  const text = String(value);
  if (!/^\d+$/u.test(text)) throw invalid();
  const workerCount = Number.parseInt(text, 10);
  if (!Number.isSafeInteger(workerCount) || workerCount < 0) throw invalid();
  if (workerCount === 0) return undefined;
  if (workerCount > maximumRuntimeWorkerCount) throw invalid();
  return workerCount;
}
