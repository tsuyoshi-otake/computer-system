export const dosMemoryConfigurationLimits = Object.freeze({
  diagnostics: 64,
  driverArguments: 16,
  driverLoads: 32,
  driverPathCharacters: 260,
  lineCharacters: 512,
  lines: 64,
  moduleIdCharacters: 64,
  residentBytes: 640 * 1_024,
  sourceCharacters: 64 * (512 + 2),
} as const);

export type DosConfigurationDriverKind = "emm386" | "himem" | "resident";

export type DosConfigurationDriverDirective = "device" | "devicehigh";

export type DosMemoryPlacement = "conventional" | "upper";

export interface DosConfigurationDriverResolutionRequest {
  readonly directive: DosConfigurationDriverDirective;
  readonly expectedKind: DosConfigurationDriverKind;
  readonly lineNumber: number;
  readonly path: string;
}

export type DosConfigurationDriverRejectionReason =
  "invalid" | "missing" | "unsupported";

export type DosConfigurationDriverResolution =
  | {
      readonly status: "rejected";
      readonly reason: DosConfigurationDriverRejectionReason;
    }
  | {
      readonly status: "resolved";
      readonly canonicalPath: string;
      readonly displayName: string;
      readonly kind: DosConfigurationDriverKind;
      readonly moduleId: string;
      readonly residentBytes: number;
    };

/**
 * Resolves an already installed, validated guest capsule. Implementations must
 * not execute the capsule. The planner bounds calls to `driverLoads` per parse.
 */
export interface DosConfigurationDriverResolver {
  resolve(
    request: DosConfigurationDriverResolutionRequest,
  ): DosConfigurationDriverResolution;
}

export interface DosConfigurationDriverPlacementPlan {
  readonly actualPlacement: DosMemoryPlacement | null;
  readonly allocationOrder: readonly DosMemoryPlacement[];
  readonly requestedPlacement: DosMemoryPlacement;
}

export interface DosConfigurationDriverLoadPlan {
  readonly arguments: readonly string[];
  readonly canonicalPath: string;
  readonly directive: DosConfigurationDriverDirective;
  readonly displayName: string;
  readonly kind: DosConfigurationDriverKind;
  readonly lineNumber: number;
  readonly moduleId: string;
  readonly placement: DosConfigurationDriverPlacementPlan;
  readonly residentBytes: number;
  readonly sourcePath: string;
}

export interface DosConfigurationModePlan {
  readonly kernelDirectiveLine: number | null;
  readonly requestedKernelPlacement: "high" | "low";
  readonly upperMemory: "disabled" | "enabled";
  readonly upperMemoryDirectiveLine: number | null;
}

export interface DosMemoryConfigurationPlan {
  readonly buffers: number | null;
  readonly dos: DosConfigurationModePlan;
  readonly drivers: readonly DosConfigurationDriverLoadPlan[];
  readonly files: number | null;
}

export type DosMemoryConfigurationDiagnosticCode =
  | "conflicting-directive"
  | "conflicting-dos-tokens"
  | "dependency-order"
  | "driver-arguments-invalid"
  | "driver-duplicate"
  | "driver-limit-exceeded"
  | "driver-not-resolved"
  | "driver-resolution-failed"
  | "driver-resolution-invalid"
  | "duplicate-dos-token"
  | "line-limit-exceeded"
  | "line-too-long"
  | "numeric-value-invalid"
  | "source-limit-exceeded"
  | "unsupported-directive"
  | "unsupported-dos-token";

export interface DosMemoryConfigurationDiagnostic {
  readonly code: DosMemoryConfigurationDiagnosticCode;
  readonly lineNumber: number;
  readonly message: string;
  readonly severity: "error";
}

export type DosMemoryConfigurationResult =
  | {
      readonly committable: false;
      readonly diagnostics: readonly DosMemoryConfigurationDiagnostic[];
      readonly plan: null;
    }
  | {
      readonly committable: true;
      readonly diagnostics: readonly [];
      readonly plan: DosMemoryConfigurationPlan;
    };

interface ExplicitValue<Value> {
  readonly lineNumber: number;
  readonly value: Value;
}

interface MutablePlanningState {
  buffers: ExplicitValue<number> | null;
  dosKernel: ExplicitValue<"high" | "low"> | null;
  dosUpperMemory: ExplicitValue<"disabled" | "enabled"> | null;
  driverDirectiveCount: number;
  drivers: DosConfigurationDriverLoadPlan[];
  emm386Loaded: boolean;
  files: ExplicitValue<number> | null;
  himemLoaded: boolean;
  moduleIds: Set<string>;
}

const moduleIdPattern = /^[a-z0-9][a-z0-9._-]*$/u;

function freezeDiagnostic(
  code: DosMemoryConfigurationDiagnosticCode,
  lineNumber: number,
  message: string,
): DosMemoryConfigurationDiagnostic {
  return Object.freeze({ code, lineNumber, message, severity: "error" });
}

function failedResult(
  diagnostics: readonly DosMemoryConfigurationDiagnostic[],
): DosMemoryConfigurationResult {
  return Object.freeze({
    committable: false,
    diagnostics: Object.freeze([...diagnostics]),
    plan: null,
  });
}

function successfulResult(
  state: Readonly<MutablePlanningState>,
): DosMemoryConfigurationResult {
  const drivers = state.drivers.map((driver) =>
    Object.freeze({
      ...driver,
      arguments: Object.freeze([...driver.arguments]),
      placement: Object.freeze({
        ...driver.placement,
        allocationOrder: Object.freeze([...driver.placement.allocationOrder]),
      }),
    }),
  );
  const plan = Object.freeze({
    buffers: state.buffers?.value ?? null,
    dos: Object.freeze({
      kernelDirectiveLine: state.dosKernel?.lineNumber ?? null,
      requestedKernelPlacement: state.dosKernel?.value ?? "low",
      upperMemory: state.dosUpperMemory?.value ?? "disabled",
      upperMemoryDirectiveLine: state.dosUpperMemory?.lineNumber ?? null,
    }),
    drivers: Object.freeze(drivers),
    files: state.files?.value ?? null,
  });
  const diagnostics: readonly [] = Object.freeze([]);
  return Object.freeze({
    committable: true,
    diagnostics,
    plan,
  });
}

function splitConfigurationLines(source: string): readonly string[] {
  if (source.length === 0) return [];
  const lines = source
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

function expectedDriverKind(path: string): DosConfigurationDriverKind {
  const name = path.split("\\").at(-1);
  if (name === "HIMEM.SYS") return "himem";
  if (name === "EMM386.EXE") return "emm386";
  return "resident";
}

function normalizeDriverPath(path: string): string {
  return path.replaceAll("/", "\\").toUpperCase();
}

function containsControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const character = value.charCodeAt(index);
    if (character <= 0x1f || character === 0x7f) return true;
  }
  return false;
}

function validResolvedDriver(
  resolution: Extract<
    DosConfigurationDriverResolution,
    { readonly status: "resolved" }
  >,
  expectedKind: DosConfigurationDriverKind,
): boolean {
  return (
    resolution.kind === expectedKind &&
    resolution.canonicalPath.length > 0 &&
    resolution.canonicalPath.length <=
      dosMemoryConfigurationLimits.driverPathCharacters &&
    !containsControlCharacters(resolution.canonicalPath) &&
    resolution.moduleId.length <=
      dosMemoryConfigurationLimits.moduleIdCharacters &&
    moduleIdPattern.test(resolution.moduleId) &&
    resolution.displayName.length > 0 &&
    resolution.displayName.length <=
      dosMemoryConfigurationLimits.lineCharacters &&
    !containsControlCharacters(resolution.displayName) &&
    Number.isSafeInteger(resolution.residentBytes) &&
    resolution.residentBytes > 0 &&
    resolution.residentBytes <= dosMemoryConfigurationLimits.residentBytes
  );
}

function parseNumericDirective(
  name: "BUFFERS" | "FILES",
  valueText: string,
  lineNumber: number,
  state: MutablePlanningState,
  addDiagnostic: (
    code: DosMemoryConfigurationDiagnosticCode,
    lineNumber: number,
    message: string,
  ) => void,
): void {
  const maximum = name === "FILES" ? 255 : 99;
  if (!/^[0-9]+$/u.test(valueText)) {
    addDiagnostic(
      "numeric-value-invalid",
      lineNumber,
      `${name} must be an integer between 1 and ${String(maximum)}`,
    );
    return;
  }
  const value = Number(valueText);
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    addDiagnostic(
      "numeric-value-invalid",
      lineNumber,
      `${name} must be between 1 and ${String(maximum)}`,
    );
    return;
  }
  const key = name === "FILES" ? "files" : "buffers";
  const previous = state[key];
  if (previous !== null && previous.value !== value) {
    addDiagnostic(
      "conflicting-directive",
      lineNumber,
      `${name}=${String(value)} conflicts with line ${String(previous.lineNumber)}`,
    );
    return;
  }
  if (previous === null) state[key] = { lineNumber, value };
}

function parseDosDirective(
  valueText: string,
  lineNumber: number,
  state: MutablePlanningState,
  addDiagnostic: (
    code: DosMemoryConfigurationDiagnosticCode,
    lineNumber: number,
    message: string,
  ) => void,
): void {
  const rawTokens = valueText
    .split(",")
    .map((token) => token.trim().toUpperCase());
  if (rawTokens.length === 0 || rawTokens.some((token) => token.length === 0)) {
    addDiagnostic(
      "unsupported-dos-token",
      lineNumber,
      "DOS requires HIGH or LOW and/or UMB or NOUMB",
    );
    return;
  }
  const tokens = new Set<string>();
  for (const token of rawTokens) {
    if (tokens.has(token)) {
      addDiagnostic(
        "duplicate-dos-token",
        lineNumber,
        `DOS token ${token} is duplicated`,
      );
      return;
    }
    tokens.add(token);
  }
  const unsupported = [...tokens].find(
    (token) =>
      token !== "HIGH" &&
      token !== "LOW" &&
      token !== "UMB" &&
      token !== "NOUMB",
  );
  if (unsupported !== undefined) {
    addDiagnostic(
      "unsupported-dos-token",
      lineNumber,
      `DOS token ${unsupported} is unsupported`,
    );
    return;
  }
  if (tokens.has("HIGH") && tokens.has("LOW")) {
    addDiagnostic(
      "conflicting-dos-tokens",
      lineNumber,
      "DOS cannot request both HIGH and LOW",
    );
    return;
  }
  if (tokens.has("UMB") && tokens.has("NOUMB")) {
    addDiagnostic(
      "conflicting-dos-tokens",
      lineNumber,
      "DOS cannot request both UMB and NOUMB",
    );
    return;
  }

  const kernel = tokens.has("HIGH") ? "high" : tokens.has("LOW") ? "low" : null;
  const upperMemory = tokens.has("UMB")
    ? "enabled"
    : tokens.has("NOUMB")
      ? "disabled"
      : null;
  if (
    kernel !== null &&
    state.dosKernel !== null &&
    state.dosKernel.value !== kernel
  ) {
    addDiagnostic(
      "conflicting-directive",
      lineNumber,
      `DOS=${kernel.toUpperCase()} conflicts with line ${String(state.dosKernel.lineNumber)}`,
    );
    return;
  }
  if (
    upperMemory !== null &&
    state.dosUpperMemory !== null &&
    state.dosUpperMemory.value !== upperMemory
  ) {
    addDiagnostic(
      "conflicting-directive",
      lineNumber,
      `DOS=${upperMemory === "enabled" ? "UMB" : "NOUMB"} conflicts with line ${String(state.dosUpperMemory.lineNumber)}`,
    );
    return;
  }

  const missingDependencies: string[] = [];
  if (kernel === "high" && !state.himemLoaded)
    missingDependencies.push("HIMEM.SYS");
  if (upperMemory === "enabled" && !state.emm386Loaded)
    missingDependencies.push("EMM386.EXE NOEMS");
  if (missingDependencies.length > 0) {
    addDiagnostic(
      "dependency-order",
      lineNumber,
      `DOS=${valueText.trim()} requires ${missingDependencies.join(" and ")} to be loaded first`,
    );
    return;
  }

  if (kernel !== null && state.dosKernel === null)
    state.dosKernel = { lineNumber, value: kernel };
  if (upperMemory !== null && state.dosUpperMemory === null)
    state.dosUpperMemory = { lineNumber, value: upperMemory };
}

function parseDriverDirective(
  directive: DosConfigurationDriverDirective,
  valueText: string,
  lineNumber: number,
  state: MutablePlanningState,
  resolver: DosConfigurationDriverResolver,
  addDiagnostic: (
    code: DosMemoryConfigurationDiagnosticCode,
    lineNumber: number,
    message: string,
  ) => void,
): void {
  state.driverDirectiveCount += 1;
  if (state.driverDirectiveCount > dosMemoryConfigurationLimits.driverLoads) {
    addDiagnostic(
      "driver-limit-exceeded",
      lineNumber,
      `CONFIG.SYS supports at most ${String(dosMemoryConfigurationLimits.driverLoads)} driver directives`,
    );
    return;
  }
  const payload = /^([^\s]+)(?:\s+(.+))?$/u.exec(valueText.trim());
  if (payload === null) {
    addDiagnostic(
      "driver-arguments-invalid",
      lineNumber,
      `${directive.toUpperCase()} requires one driver path`,
    );
    return;
  }
  const sourcePath = normalizeDriverPath(payload[1]!);
  if (
    sourcePath.length === 0 ||
    sourcePath.length > dosMemoryConfigurationLimits.driverPathCharacters ||
    containsControlCharacters(sourcePath)
  ) {
    addDiagnostic(
      "driver-arguments-invalid",
      lineNumber,
      "Driver path is invalid or exceeds the configured limit",
    );
    return;
  }
  const expectedKind = expectedDriverKind(sourcePath);
  let arguments_ =
    payload[2] === undefined ? [] : payload[2].trim().split(/\s+/u);
  if (arguments_.length > dosMemoryConfigurationLimits.driverArguments) {
    addDiagnostic(
      "driver-arguments-invalid",
      lineNumber,
      `Driver arguments exceed the ${String(dosMemoryConfigurationLimits.driverArguments)} token limit`,
    );
    return;
  }
  if (expectedKind === "himem" && arguments_.length > 0) {
    addDiagnostic(
      "driver-arguments-invalid",
      lineNumber,
      "HIMEM.SYS does not support options in the CS-DOS memory model",
    );
    return;
  }
  if (
    expectedKind === "emm386" &&
    (arguments_.length !== 1 || arguments_[0]!.toUpperCase() !== "NOEMS")
  ) {
    addDiagnostic(
      "driver-arguments-invalid",
      lineNumber,
      "EMM386.EXE requires exactly NOEMS; native EMS is not implemented",
    );
    return;
  }
  if (expectedKind === "emm386") arguments_ = ["NOEMS"];

  if (expectedKind === "emm386" && !state.himemLoaded) {
    addDiagnostic(
      "dependency-order",
      lineNumber,
      "EMM386.EXE NOEMS requires HIMEM.SYS to be loaded first",
    );
    return;
  }
  if (
    directive === "devicehigh" &&
    (!state.emm386Loaded || state.dosUpperMemory?.value !== "enabled")
  ) {
    addDiagnostic(
      "dependency-order",
      lineNumber,
      "DEVICEHIGH requires EMM386.EXE NOEMS and DOS=UMB to be active first",
    );
    return;
  }

  let resolution: DosConfigurationDriverResolution;
  try {
    resolution = resolver.resolve(
      Object.freeze({ directive, expectedKind, lineNumber, path: sourcePath }),
    );
  } catch {
    addDiagnostic(
      "driver-resolution-failed",
      lineNumber,
      `Driver resolver failed for ${sourcePath}`,
    );
    return;
  }
  if (resolution.status === "rejected") {
    addDiagnostic(
      "driver-not-resolved",
      lineNumber,
      `${sourcePath} is ${resolution.reason}`,
    );
    return;
  }
  if (!validResolvedDriver(resolution, expectedKind)) {
    addDiagnostic(
      "driver-resolution-invalid",
      lineNumber,
      `Driver resolver returned invalid metadata for ${sourcePath}`,
    );
    return;
  }
  const normalizedModuleId = resolution.moduleId.toLowerCase();
  if (state.moduleIds.has(normalizedModuleId)) {
    addDiagnostic(
      "driver-duplicate",
      lineNumber,
      `Driver module ${resolution.moduleId} is already loaded`,
    );
    return;
  }
  if (expectedKind === "himem" && state.himemLoaded) {
    addDiagnostic(
      "driver-duplicate",
      lineNumber,
      "HIMEM.SYS is already loaded",
    );
    return;
  }
  if (expectedKind === "emm386" && state.emm386Loaded) {
    addDiagnostic(
      "driver-duplicate",
      lineNumber,
      "EMM386.EXE is already loaded",
    );
    return;
  }

  const requestedPlacement =
    directive === "devicehigh" ? "upper" : "conventional";
  const allocationOrder: readonly DosMemoryPlacement[] =
    requestedPlacement === "upper"
      ? Object.freeze(["upper", "conventional"])
      : Object.freeze(["conventional"]);
  state.drivers.push({
    arguments: Object.freeze([...arguments_]),
    canonicalPath: resolution.canonicalPath,
    directive,
    displayName: resolution.displayName,
    kind: resolution.kind,
    lineNumber,
    moduleId: resolution.moduleId,
    placement: Object.freeze({
      actualPlacement: null,
      allocationOrder,
      requestedPlacement,
    }),
    residentBytes: resolution.residentBytes,
    sourcePath,
  });
  state.moduleIds.add(normalizedModuleId);
  if (expectedKind === "himem") state.himemLoaded = true;
  if (expectedKind === "emm386") state.emm386Loaded = true;
}

/**
 * Parses and plans the supported CS-DOS CONFIG.SYS memory subset. It performs
 * no mutation or I/O and never returns a partial plan: any diagnostic makes the
 * result non-committable while parsing continues within fixed limits.
 */
export function planDosMemoryConfiguration(
  source: string,
  resolver: DosConfigurationDriverResolver,
): DosMemoryConfigurationResult {
  if (source.length > dosMemoryConfigurationLimits.sourceCharacters) {
    return failedResult([
      freezeDiagnostic(
        "source-limit-exceeded",
        0,
        `CONFIG.SYS exceeds ${String(dosMemoryConfigurationLimits.sourceCharacters)} characters`,
      ),
    ]);
  }
  const lines = splitConfigurationLines(source);
  if (lines.length > dosMemoryConfigurationLimits.lines) {
    return failedResult([
      freezeDiagnostic(
        "line-limit-exceeded",
        dosMemoryConfigurationLimits.lines + 1,
        `CONFIG.SYS supports at most ${String(dosMemoryConfigurationLimits.lines)} lines`,
      ),
    ]);
  }

  const diagnostics: DosMemoryConfigurationDiagnostic[] = [];
  const addDiagnostic = (
    code: DosMemoryConfigurationDiagnosticCode,
    lineNumber: number,
    message: string,
  ): void => {
    if (diagnostics.length >= dosMemoryConfigurationLimits.diagnostics) return;
    diagnostics.push(freezeDiagnostic(code, lineNumber, message));
  };
  const state: MutablePlanningState = {
    buffers: null,
    dosKernel: null,
    dosUpperMemory: null,
    driverDirectiveCount: 0,
    drivers: [],
    emm386Loaded: false,
    files: null,
    himemLoaded: false,
    moduleIds: new Set(),
  };

  for (const [index, sourceLine] of lines.entries()) {
    const lineNumber = index + 1;
    if (sourceLine.length > dosMemoryConfigurationLimits.lineCharacters) {
      addDiagnostic(
        "line-too-long",
        lineNumber,
        `CONFIG.SYS line exceeds ${String(dosMemoryConfigurationLimits.lineCharacters)} characters`,
      );
      continue;
    }
    const line = sourceLine.trim();
    if (
      line.length === 0 ||
      line.startsWith(";") ||
      /^REM(?:\s|$)/iu.test(line)
    )
      continue;

    const assignment = /^([A-Z]+)\s*=\s*(.*)$/iu.exec(line);
    if (assignment === null) {
      addDiagnostic(
        "unsupported-directive",
        lineNumber,
        `Unsupported CONFIG.SYS directive: ${line.slice(0, 96)}`,
      );
      continue;
    }
    const name = assignment[1]!.toUpperCase();
    const valueText = assignment[2]!.trim();
    if (name === "FILES" || name === "BUFFERS") {
      parseNumericDirective(name, valueText, lineNumber, state, addDiagnostic);
      continue;
    }
    if (name === "DOS") {
      parseDosDirective(valueText, lineNumber, state, addDiagnostic);
      continue;
    }
    if (name === "DEVICE" || name === "DEVICEHIGH") {
      parseDriverDirective(
        name === "DEVICE" ? "device" : "devicehigh",
        valueText,
        lineNumber,
        state,
        resolver,
        addDiagnostic,
      );
      continue;
    }
    addDiagnostic(
      "unsupported-directive",
      lineNumber,
      `Unsupported CONFIG.SYS directive: ${line.slice(0, 96)}`,
    );
  }

  return diagnostics.length > 0
    ? failedResult(diagnostics)
    : successfulResult(state);
}
