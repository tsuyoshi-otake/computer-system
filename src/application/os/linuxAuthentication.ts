import type { InMemoryFilesystem } from "../../domain/filesystem/inMemoryFilesystem.js";
import { utf8ByteLength } from "../../domain/text/utf8.js";
import { sha256Hex } from "./passwordHash.js";

const shadowPath = "/etc/shadow";
const algorithm = "cs-sha256-v1";
const rounds = 512;
const maximumPasswordBytes = 64;
const minimumPasswordCharacters = 8;

type AuthenticationState =
  | { readonly kind: "authenticated" | "disabled" | "unavailable" }
  | { readonly kind: "login"; readonly failures: number }
  | { readonly kind: "setup-confirm"; readonly candidate: string }
  | { readonly kind: "setup-new" };

export interface LinuxAuthenticationResult {
  readonly exitCode: number;
  readonly handled: boolean;
  readonly sleepTicks?: number;
  readonly stderr: string;
  readonly stdout: string;
}

export interface LinuxAuthenticationOptions {
  readonly enabled: boolean;
  readonly salt?: () => string;
}

export class LinuxAuthentication {
  private state: AuthenticationState;
  private readonly salt: () => string;

  constructor(
    private readonly filesystem: InMemoryFilesystem,
    options: LinuxAuthenticationOptions,
  ) {
    this.salt = options.salt ?? randomSalt;
    if (!options.enabled) this.state = { kind: "disabled" };
    else if (!filesystem.exists(shadowPath)) this.state = { kind: "setup-new" };
    else {
      this.state = parsePasswordRecord(filesystem.readFile(shadowPath))
        ? { kind: "login", failures: 0 }
        : { kind: "unavailable" };
    }
  }

  isAuthenticated(): boolean {
    return (
      this.state.kind === "authenticated" || this.state.kind === "disabled"
    );
  }

  isSecretInput(): boolean {
    return (
      this.state.kind === "login" ||
      this.state.kind === "setup-confirm" ||
      this.state.kind === "setup-new"
    );
  }

  prompt(): string | undefined {
    switch (this.state.kind) {
      case "login":
        return "Password: ";
      case "setup-confirm":
        return "Retype new password: ";
      case "setup-new":
        return "New password: ";
      case "unavailable":
        return "Login unavailable> ";
      default:
        return undefined;
    }
  }

  startupLines(): readonly string[] {
    switch (this.state.kind) {
      case "login":
      case "setup-new":
        return [];
      case "unavailable":
        return ["CS-Linux login unavailable: /etc/shadow is invalid."];
      default:
        return [];
    }
  }

  submit(password: string): LinuxAuthenticationResult {
    switch (this.state.kind) {
      case "authenticated":
      case "disabled":
        return result(false, "", "", 0);
      case "unavailable":
        return result(true, "", "login: password database is unavailable\n", 1);
      case "setup-new":
        return this.acceptNewPassword(password);
      case "setup-confirm":
        return this.confirmNewPassword(password, this.state.candidate);
      case "login":
        return this.authenticate(password, this.state.failures);
    }
  }

  private acceptNewPassword(password: string): LinuxAuthenticationResult {
    const problem = validatePassword(password);
    if (problem !== undefined)
      return result(true, "", `passwd: ${problem}\n`, 1);
    this.state = { kind: "setup-confirm", candidate: password };
    return result(true, "", "", 0);
  }

  private confirmNewPassword(
    password: string,
    candidate: string,
  ): LinuxAuthenticationResult {
    if (!constantTimeEqual(password, candidate)) {
      this.state = { kind: "setup-new" };
      return result(
        true,
        "",
        "passwd: passwords do not match; start again\n",
        1,
      );
    }
    const salt = this.salt();
    if (!/^[A-Za-z0-9_-]{16,32}$/u.test(salt)) {
      this.state = { kind: "setup-new" };
      return result(true, "", "passwd: password salt is unavailable\n", 1);
    }
    this.filesystem.writeFile(
      shadowPath,
      `${createPasswordRecord(password, salt)}\n`,
    );
    this.filesystem.setMetadata(shadowPath, { gid: 0, mode: 0o600, uid: 0 });
    this.state = { kind: "authenticated" };
    return result(true, "Password configured.\n", "", 0);
  }

  private authenticate(
    password: string,
    failures: number,
  ): LinuxAuthenticationResult {
    const record = this.filesystem.readFile(shadowPath);
    if (verifyPassword(password, record)) {
      this.state = { kind: "authenticated" };
      return result(true, "Login successful.\n", "", 0);
    }
    const nextFailures = failures + 1;
    if (nextFailures >= 3) {
      this.state = { kind: "login", failures: 0 };
      return {
        ...result(
          true,
          "",
          "Login incorrect.\nToo many attempts; retrying in 2 seconds.\n",
          1,
        ),
        sleepTicks: 40,
      };
    }
    this.state = { kind: "login", failures: nextFailures };
    return result(true, "", "Login incorrect.\n", 1);
  }
}

export function createPasswordRecord(password: string, salt: string): string {
  let digest = sha256Hex(`${salt}:${password}`);
  for (let iteration = 1; iteration < rounds; iteration += 1) {
    digest = sha256Hex(`${salt}:${digest}`);
  }
  return `computer:${algorithm}:${String(rounds)}:${salt}:${digest}`;
}

export function verifyPassword(password: string, encoded: string): boolean {
  const parsed = parsePasswordRecord(encoded);
  if (parsed === undefined) return false;
  return constantTimeEqual(
    createPasswordRecord(password, parsed.salt),
    parsed.normalized,
  );
}

function parsePasswordRecord(
  encoded: string,
): { readonly normalized: string; readonly salt: string } | undefined {
  const normalized = encoded.trim();
  const match =
    /^computer:cs-sha256-v1:512:([A-Za-z0-9_-]{16,32}):([0-9a-f]{64})$/u.exec(
      normalized,
    );
  return match === null ? undefined : { normalized, salt: match[1] ?? "" };
}

function validatePassword(password: string): string | undefined {
  if ([...password].length < minimumPasswordCharacters)
    return `password must contain at least ${String(minimumPasswordCharacters)} characters`;
  if (utf8ByteLength(password) > maximumPasswordBytes)
    return `password must not exceed ${String(maximumPasswordBytes)} UTF-8 bytes`;
  if (/\0|[\r\n]/u.test(password))
    return "password contains an invalid control character";
  return undefined;
}

function constantTimeEqual(left: string, right: string): boolean {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    difference |=
      (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

function randomSalt(): string {
  return sha256Hex(
    `${String(Date.now())}:${String(Math.random())}:${String(Math.random())}`,
  ).slice(0, 20);
}

function result(
  handled: boolean,
  stdout: string,
  stderr: string,
  exitCode: number,
): LinuxAuthenticationResult {
  return { exitCode, handled, stderr, stdout };
}
