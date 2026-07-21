import { describe, expect, it } from "vitest";

import {
  parseLinuxGitRemoteEndpoint,
  type LinuxGitCredentialHandle,
  type LinuxGitRemotePort,
  type LinuxGitRemoteRepositoryPort,
  type LinuxGitRemoteSession,
  type LinuxGitRemoteStepBudget,
  type LinuxGitRemoteStepResult,
  type LinuxGitRemoteTerminalResult,
} from "../../src/application/os/linuxGitRemote.js";

class ReconciliationSession implements LinuxGitRemoteSession {
  private phase = 0;
  private terminalResult: LinuxGitRemoteTerminalResult | undefined;

  constructor(private readonly credential: LinuxGitCredentialHandle) {}

  get terminal(): boolean {
    return this.terminalResult !== undefined;
  }

  cancel(reason: string): LinuxGitRemoteTerminalResult {
    return (
      this.terminalResult ??
      this.finish({ kind: "terminal", message: reason, state: "cancelled" })
    );
  }

  step(budget: LinuxGitRemoteStepBudget): LinuxGitRemoteStepResult {
    if (this.terminalResult !== undefined) return this.terminalResult;
    expect(budget.maximumBytes).toBeGreaterThan(0);
    if (this.phase === 0) {
      this.phase += 1;
      return {
        kind: "continue",
        minimumDelayTicks: 0,
        progress: {
          bytesTransferred: 0,
          objectsTransferred: 0,
          phase: "authenticating",
        },
      };
    }
    return this.finish({
      kind: "terminal",
      message: "ref acknowledgement lost; reconcile before retry",
      state: "unknown",
    });
  }

  private finish(
    result: LinuxGitRemoteTerminalResult,
  ): LinuxGitRemoteTerminalResult {
    this.credential.release();
    this.terminalResult = result;
    return result;
  }
}

class TestCredential implements LinuxGitCredentialHandle {
  readonly authentication = "public_key";
  readonly scope = "origin";
  private releasedValue = false;

  get released(): boolean {
    return this.releasedValue;
  }

  release(): void {
    this.releasedValue = true;
  }

  respond(challenge: Uint8Array, maximumResponseBytes: number): Uint8Array {
    return challenge.slice(0, maximumResponseBytes);
  }
}

const repositoryPort: LinuxGitRemoteRepositoryPort = {
  beginQuarantine: () => ({
    append: (): void => undefined,
    discard: (): void => undefined,
    finalized: false,
    promote: (): void => undefined,
    verifyStep: () => ({ kind: "verified" }),
  }),
  hasObject: () => false,
  listRefs: () => [],
  openObject: (oid) => ({
    close: (): void => undefined,
    closed: false,
    descriptor: { oid, size: 0, type: "blob" },
    read: () => new Uint8Array(),
  }),
};

describe("future CS System Git remote port", (): void => {
  it("accepts only authenticated transport schemes without inline credentials", (): void => {
    expect(parseLinuxGitRemoteEndpoint("cs+tcp://host.test/team/repo")).toEqual(
      {
        authority: "host.test",
        repository: "team/repo",
        scheme: "cs+tcp",
      },
    );
    expect(() => parseLinuxGitRemoteEndpoint("git://host.test/repo")).toThrow(
      "must use cs+tcp://, ssh://, or https://",
    );
    expect(() =>
      parseLinuxGitRemoteEndpoint("ssh://user@host.test/repo"),
    ).toThrow("must not contain inline credentials");
    expect(() =>
      parseLinuxGitRemoteEndpoint("https://host.test/a/../b"),
    ).toThrow("unsafe segment");
    expect(() => parseLinuxGitRemoteEndpoint("https://host.test/a//b")).toThrow(
      "unsafe segment",
    );
    expect(() =>
      parseLinuxGitRemoteEndpoint("https://host.test/a/%2e%2e/b"),
    ).toThrow("unsafe segment");
    expect(
      parseLinuxGitRemoteEndpoint("ssh://HOST.TEST:22/team/repo.git"),
    ).toMatchObject({ authority: "host.test:22" });
    expect(
      parseLinuxGitRemoteEndpoint("cs+tcp://[2001:db8::1]:9418/team/repo"),
    ).toMatchObject({ authority: "[2001:db8::1]:9418" });
    expect(() =>
      parseLinuxGitRemoteEndpoint("https://host.test:0/team/repo"),
    ).toThrow("port must be between 1 and 65535");
    expect(() =>
      parseLinuxGitRemoteEndpoint("https://[:::::]/team/repo"),
    ).toThrow("authority is invalid");
    expect(() =>
      parseLinuxGitRemoteEndpoint("https://host.test/team\\repo"),
    ).toThrow("unsafe segment");
  });

  it("models bounded cancellation and unknown ref-update outcomes explicitly", (): void => {
    let issuedCredential: TestCredential | undefined;
    const port: LinuxGitRemotePort = {
      begin: (request, repository, credentials) => {
        expect(repository).toBe(repositoryPort);
        issuedCredential = credentials.acquire(
          {
            authority: request.endpoint.authority,
            fingerprint: "sha256:peer",
            security: "tls_certificate",
          },
          request.endpoint,
          request.remoteName,
          request.operation,
        ) as TestCredential;
        return new ReconciliationSession(issuedCredential);
      },
    };
    const session = port.begin(
      {
        endpoint: parseLinuxGitRemoteEndpoint("https://host.test/team/repo"),
        limits: {
          maximumBytes: 8_388_608,
          maximumObjects: 2_048,
          maximumRefs: 128,
          maximumSteps: 4_096,
          maximumWorkUnits: 1_000_000,
        },
        operation: "push",
        protocol: {
          optionalCapabilities: ["unknown-outcome-v1"],
          requiredCapabilities: [
            "object-format-sha256",
            "quarantine-v1",
            "ref-cas",
          ],
          versions: [1],
        },
        refUpdates: [
          {
            expectedOldOid: "0".repeat(64),
            name: "refs/heads/main",
            newOid: "1".repeat(64),
          },
        ],
        remoteName: "origin",
        requestId: "request-1",
        wants: [],
      },
      repositoryPort,
      {
        acquire: () => new TestCredential(),
      },
    );
    expect(
      session.step({
        maximumBytes: 1_024,
        maximumObjects: 1,
        maximumWorkUnits: 8,
      }),
    ).toMatchObject({
      kind: "continue",
      progress: { phase: "authenticating" },
    });
    expect(
      session.step({
        maximumBytes: 1_024,
        maximumObjects: 1,
        maximumWorkUnits: 8,
      }),
    ).toEqual({
      kind: "terminal",
      message: "ref acknowledgement lost; reconcile before retry",
      state: "unknown",
    });
    expect(session.terminal).toBe(true);
    expect(issuedCredential?.released).toBe(true);
    expect(
      session.step({
        maximumBytes: 1,
        maximumObjects: 1,
        maximumWorkUnits: 1,
      }),
    ).toMatchObject({ kind: "terminal", state: "unknown" });
  });
});
