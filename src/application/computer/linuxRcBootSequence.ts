import type { ComputerRecord } from "../../domain/computer/computer.js";
import type { OsRuntimeState } from "../os/osRuntimeState.js";
import { writeTerminalLines } from "../runtime/nativeModules.js";

const rcLineWidth = 80;
const rcStatusText = Object.freeze({ fail: "[FAIL]", ok: "[ OK ]" });
const rcHiddenServiceNames: ReadonlySet<string> = new Set([
  "cs-init",
  "cs-login",
]);

/**
 * Renders authentic "Starting <service>... [ OK ]" rc.d boot chatter for the
 * services `initializeLinuxRuntimePresence` already started synchronously
 * during ShellSession construction. This is a pure rendering pass over
 * already-established `OsRuntimeState` service records - it starts nothing
 * itself - so it can run inline within the existing single-tick CSBIOS-ready
 * handoff without requiring any additional paced ticks. `cs-init`/`cs-login`
 * keep their existing journal-only boot messages and are not re-rendered
 * here to avoid duplicating the pre-existing boot-message contract.
 */
export function renderLinuxRcBootChatter(
  record: ComputerRecord,
  runtime: OsRuntimeState,
): void {
  const lines = runtime
    .services()
    .filter((service) => !rcHiddenServiceNames.has(service.name))
    .map((service) => formatRcLine(service.name, service.state === "running"));
  if (lines.length > 0) writeTerminalLines(record.terminal, lines);
}

function formatRcLine(label: string, ok: boolean): string {
  const prefix = `Starting ${label}...`;
  const status = ok ? rcStatusText.ok : rcStatusText.fail;
  if (prefix.length + 1 + status.length >= rcLineWidth) {
    return `${prefix.slice(0, rcLineWidth - status.length - 1)} ${status}`;
  }
  return `${prefix.padEnd(rcLineWidth - status.length)}${status}`;
}
