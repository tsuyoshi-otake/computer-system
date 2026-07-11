export const probeLogPrefix = "CS_PROBE_RESULT ";

export type ProbeStatus = "PASS" | "FAIL" | "BUSY";

export interface ProbeRecord {
  readonly runId: string;
  readonly probe: string;
  readonly status: ProbeStatus;
  readonly details: Readonly<Record<string, boolean | number | string>>;
}

export function formatProbeRecord(record: ProbeRecord): string {
  return `${probeLogPrefix}${JSON.stringify(record)}`;
}
