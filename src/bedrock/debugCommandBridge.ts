import { computerHost } from "./computerHost.js";
import { ensureComputer, identityService } from "./computerRegistry.js";

const responseMarker = "CS_DEBUG_COMMAND ";
const requestPattern =
  /^(d[a-z0-9]+-[a-z0-9]+) (c-[0-9a-hjkmnp-tv-z]{6}) v([^\s]{1,180})$/u;
const maximumOutputCharacters = 8_192;

export function handleDebugCommand(message: string): void {
  const match = requestPattern.exec(message);
  if (match === null) {
    console.warn(
      `${responseMarker}${JSON.stringify({ status: "rejected", error: "invalid_request" })}`,
    );
    return;
  }
  const [, requestId, computerId, encoded] = match;
  try {
    const command = decodeURIComponent(encoded ?? "");
    const observation = identityService().observation(computerId ?? "");
    if (observation === undefined) {
      emit({
        requestId,
        computerId,
        status: "missing",
        error: "Computer identity is unavailable.",
      });
      return;
    }
    const record = ensureComputer(observation.computerId, observation.family);
    if (record.lifecycle.state.kind === "off") {
      const powered = computerHost.runtime.powerOn(record.computerId);
      if (powered.outcome === "failed") throw powered.error;
    }
    const result = computerHost.runtime.executeDebugShellCommand(
      record.computerId,
      command,
    );
    if (result.outcome === "completed") {
      emit({
        requestId,
        computerId: record.computerId,
        status: "completed",
        exitCode: result.exitCode,
        stdout: truncate(result.stdout),
        stderr: truncate(result.stderr),
        cpuCycles: result.cpuCycles,
      });
      return;
    }
    emit({
      requestId,
      computerId: record.computerId,
      status: result.outcome,
      error:
        result.outcome === "failed"
          ? result.error.message
          : result.outcome === "ignored"
            ? result.reason
            : "Computer is unavailable.",
    });
  } catch (error: unknown) {
    emit({
      requestId,
      computerId,
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function emit(payload: Readonly<Record<string, unknown>>): void {
  console.warn(`${responseMarker}${JSON.stringify(payload)}`);
}

function truncate(value: string): string {
  if (value.length <= maximumOutputCharacters) return value;
  return `${value.slice(0, maximumOutputCharacters)}\n[output truncated]\n`;
}
