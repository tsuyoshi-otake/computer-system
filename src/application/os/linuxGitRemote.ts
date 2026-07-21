export type LinuxGitRemoteOperation = "clone" | "fetch" | "pull" | "push";

export type LinuxGitRemotePhase =
  | "connecting"
  | "authenticating"
  | "negotiating"
  | "transferring"
  | "verifying"
  | "updating_ref";

export type LinuxGitRemoteTerminalState =
  "cancelled" | "complete" | "failed" | "unknown";

export interface LinuxGitRemoteEndpoint {
  readonly authority: string;
  readonly repository: string;
  readonly scheme: "cs+tcp" | "https" | "ssh";
}

export type LinuxGitRemoteCapability =
  | "chunked-objects"
  | "object-format-sha256"
  | "quarantine-v1"
  | "ref-cas"
  | "unknown-outcome-v1";

export interface LinuxGitRemoteProtocolOffer {
  readonly optionalCapabilities: readonly LinuxGitRemoteCapability[];
  readonly requiredCapabilities: readonly LinuxGitRemoteCapability[];
  readonly versions: readonly number[];
}

/** Total ceilings are independent from the smaller budget supplied per tick. */
export interface LinuxGitRemoteOperationLimits {
  readonly maximumBytes: number;
  readonly maximumObjects: number;
  readonly maximumRefs: number;
  readonly maximumSteps: number;
  readonly maximumWorkUnits: number;
}

export interface LinuxGitRemoteRefUpdate {
  /** A compare-and-swap precondition. Undefined is valid only for a new ref. */
  readonly expectedOldOid: string | undefined;
  readonly name: string;
  readonly newOid: string;
}

export interface LinuxGitRemoteRefSnapshot {
  readonly name: string;
  readonly oid: string;
}

export interface LinuxGitRemoteRequest {
  readonly endpoint: LinuxGitRemoteEndpoint;
  readonly limits: LinuxGitRemoteOperationLimits;
  readonly operation: LinuxGitRemoteOperation;
  readonly protocol: LinuxGitRemoteProtocolOffer;
  readonly refUpdates: readonly LinuxGitRemoteRefUpdate[];
  readonly remoteName: string;
  /** Bounded guest-generated correlation key used to reconcile unknown results. */
  readonly requestId: string;
  readonly wants: readonly string[];
}

export interface LinuxGitRemoteStepBudget {
  readonly maximumBytes: number;
  readonly maximumObjects: number;
  readonly maximumWorkUnits: number;
}

export interface LinuxGitRemoteProgress {
  readonly bytesTransferred: number;
  readonly objectsTransferred: number;
  readonly phase: LinuxGitRemotePhase;
}

export type LinuxGitRemoteStepResult =
  | {
      readonly kind: "continue";
      /** Enforces guest-tick backoff, including peer Retry-After windows. */
      readonly minimumDelayTicks: number;
      readonly progress: LinuxGitRemoteProgress;
    }
  | LinuxGitRemoteTerminalResult;

export interface LinuxGitRemoteTerminalResult {
  readonly kind: "terminal";
  readonly message: string;
  readonly state: LinuxGitRemoteTerminalState;
}

/**
 * One bounded, cancellable remote operation. A transport owns finalization.
 * In particular, an acknowledgement loss after a ref update must finish as
 * `unknown`; callers reconcile the advertised ref before attempting a retry.
 * After the first terminal result, `step`/`cancel` must return that same result
 * without more I/O. The session releases every object reader, quarantine,
 * credential handle, and byte-stream lease exactly once on all terminal paths.
 */
export interface LinuxGitRemoteSession {
  readonly terminal: boolean;
  cancel(reason: string): LinuxGitRemoteTerminalResult;
  step(budget: LinuxGitRemoteStepBudget): LinuxGitRemoteStepResult;
}

export interface LinuxGitRemoteObjectDescriptor {
  readonly oid: string;
  readonly size: number;
  readonly type: "blob" | "commit" | "tree";
}

export interface LinuxGitRemoteObjectReader {
  readonly closed: boolean;
  readonly descriptor: LinuxGitRemoteObjectDescriptor;
  close(): void;
  /** Returns at most maximumBytes and never advances hidden shared state. */
  read(offset: number, maximumBytes: number): Uint8Array;
}

export type LinuxGitRemoteQuarantineVerification =
  | { readonly kind: "continue"; readonly workUnits: number }
  | { readonly kind: "failed"; readonly message: string }
  | { readonly kind: "verified" };

/**
 * Guest-backed quarantine. `promote` verifies every staged hash/edge first, then
 * publishes objects and compare-and-swap ref updates in one filesystem
 * transaction. `discard` owns all failure and cancellation cleanup.
 */
export interface LinuxGitRemoteQuarantine {
  readonly finalized: boolean;
  append(
    descriptor: LinuxGitRemoteObjectDescriptor,
    offset: number,
    bytes: Uint8Array,
  ): void;
  discard(): void;
  promote(refUpdates: readonly LinuxGitRemoteRefUpdate[]): void;
  verifyStep(maximumWorkUnits: number): LinuxGitRemoteQuarantineVerification;
}

/** Stable application port; implementations are credentialed guest stores. */
export interface LinuxGitRemoteRepositoryPort {
  beginQuarantine(
    limits: LinuxGitRemoteOperationLimits,
  ): LinuxGitRemoteQuarantine;
  hasObject(oid: string): boolean;
  listRefs(maximumRefs: number): readonly LinuxGitRemoteRefSnapshot[];
  openObject(oid: string): LinuxGitRemoteObjectReader;
}

/**
 * Application-layer port for a future authenticated guest network transport.
 * Implementations may use the guest TCP/IP stack, but may never invoke host
 * Git, host networking, a credential helper, or a host shell. TLS certificates,
 * SSH host keys, or the CS authenticated-channel peer must be verified against
 * a guest trust store before acquiring credentials.
 */
export interface LinuxGitRemotePort {
  begin(
    request: LinuxGitRemoteRequest,
    repository: LinuxGitRemoteRepositoryPort,
    credentials: LinuxGitCredentialProvider,
  ): LinuxGitRemoteSession;
}

export interface LinuxGitRemotePeerIdentity {
  readonly authority: string;
  readonly fingerprint: string;
  readonly security: "authenticated_cs" | "ssh_host_key" | "tls_certificate";
}

export interface LinuxGitCredentialHandle {
  readonly authentication: "bearer" | "public_key";
  readonly released: boolean;
  readonly scope: string;
  /** Produces one bounded proof without exposing stored secret material. */
  respond(challenge: Uint8Array, maximumResponseBytes: number): Uint8Array;
  release(): void;
}

export interface LinuxGitCredentialProvider {
  acquire(
    peer: LinuxGitRemotePeerIdentity,
    endpoint: LinuxGitRemoteEndpoint,
    remoteName: string,
    operation: LinuxGitRemoteOperation,
  ): LinuxGitCredentialHandle;
}

export function parseLinuxGitRemoteEndpoint(
  value: string,
): LinuxGitRemoteEndpoint {
  if (value.length === 0 || value.length > 512) {
    throw new Error("remote URL must contain between 1 and 512 characters");
  }
  if (
    [...value].some((character): boolean => {
      const codePoint = character.codePointAt(0)!;
      return /\s/u.test(character) || codePoint <= 0x1f || codePoint === 0x7f;
    })
  ) {
    throw new Error("remote URL contains whitespace or a control character");
  }
  const match = /^(cs\+tcp|https|ssh):\/\/([^/]+)\/(.+)$/u.exec(value);
  if (match === null) {
    throw new Error("remote URL must use cs+tcp://, ssh://, or https://");
  }
  const [, scheme, authority, repository] = match;
  if (
    scheme === undefined ||
    authority === undefined ||
    repository === undefined
  ) {
    throw new Error("remote URL is incomplete");
  }
  if (authority.includes("@")) {
    throw new Error("remote URL must not contain inline credentials");
  }
  if (authority.length > 255 || repository.length > 255) {
    throw new Error("remote URL component exceeds 255 characters");
  }
  const repositoryParts = repository.split("/");
  if (
    repository.includes("?") ||
    repository.includes("#") ||
    repository.includes("%") ||
    repository.includes("\\") ||
    repositoryParts.some(
      (part) =>
        part.length === 0 ||
        part.length > 64 ||
        part === "." ||
        part === ".." ||
        !/^[A-Za-z0-9._-]+$/u.test(part),
    )
  ) {
    throw new Error("remote repository path contains an unsafe segment");
  }
  const canonicalAuthority = parseRemoteAuthority(authority);
  return Object.freeze({
    authority: canonicalAuthority,
    repository,
    scheme,
  }) as LinuxGitRemoteEndpoint;
}

function parseRemoteAuthority(authority: string): string {
  if (
    authority.includes("?") ||
    authority.includes("#") ||
    authority.includes("%") ||
    authority.includes("\\")
  ) {
    throw new Error("remote authority is invalid");
  }
  let host: string;
  let portText: string | undefined;
  let bracketed = false;
  if (authority.startsWith("[")) {
    const match = /^\[([0-9A-Fa-f:]+)\](?::([0-9]{1,5}))?$/u.exec(authority);
    if (match === null || !validIpv6Literal(match[1]!)) {
      throw new Error("remote authority is invalid");
    }
    host = match[1]!;
    portText = match[2];
    bracketed = true;
  } else {
    const match = /^([^:]+)(?::([0-9]{1,5}))?$/u.exec(authority);
    if (match === null) throw new Error("remote authority is invalid");
    host = match[1]!;
    portText = match[2];
    const labels = host.split(".");
    if (
      host.length > 253 ||
      labels.some(
        (label) =>
          label.length === 0 ||
          label.length > 63 ||
          !/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/u.test(label),
      )
    ) {
      throw new Error("remote authority is invalid");
    }
  }
  if (portText !== undefined) {
    const port = Number(portText);
    if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
      throw new Error("remote port must be between 1 and 65535");
    }
  }
  const canonicalHost = host.toLowerCase();
  return `${bracketed ? `[${canonicalHost}]` : canonicalHost}${portText === undefined ? "" : `:${String(Number(portText))}`}`;
}

function validIpv6Literal(value: string): boolean {
  if (
    (value.startsWith(":") && !value.startsWith("::")) ||
    (value.endsWith(":") && !value.endsWith("::")) ||
    value.indexOf("::") !== value.lastIndexOf("::")
  ) {
    return false;
  }
  const groups = value.split(":").filter((group) => group.length > 0);
  if (groups.some((group) => !/^[0-9A-Fa-f]{1,4}$/u.test(group))) {
    return false;
  }
  return value.includes("::") ? groups.length < 8 : groups.length === 8;
}
