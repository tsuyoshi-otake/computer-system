import { utf8ByteLength } from "../../domain/text/utf8.js";
import {
  type LinuxAccountDatabase,
  type LinuxUserRecord,
} from "./linuxAccounts.js";
import {
  createLoginCredentials,
  initialUserId,
  initialUserName,
  type ProcessCredentials,
} from "./linuxCredentials.js";
import { sha256Hex } from "./passwordHash.js";

const algorithm = "cs-sha256-v1";
const rounds = 512;
const maximumPasswordBytes = 64;
const minimumPasswordCharacters = 8;

type AuthenticationState =
  | {
      readonly credentials: ProcessCredentials;
      readonly kind: "authenticated" | "disabled";
    }
  | { readonly kind: "unavailable" }
  | { readonly failures: number; readonly kind: "login-name" }
  | {
      readonly failures: number;
      readonly kind: "login-password";
      readonly username: string;
    }
  | {
      readonly candidate: string;
      readonly kind: "setup-confirm";
      readonly username: string;
    }
  | { readonly kind: "setup-new"; readonly username: string };

export interface LinuxAuthenticationResult {
  readonly audit?: LinuxAuthenticationAudit;
  readonly exitCode: number;
  readonly handled: boolean;
  readonly sleepTicks?: number;
  readonly stderr: string;
  readonly stdout: string;
}

export type LinuxAuthenticationAudit =
  | { readonly kind: "login-failure"; readonly username: string }
  | { readonly kind: "login-success"; readonly username: string }
  | { readonly kind: "password-configured"; readonly username: string };

export interface LinuxAuthenticationOptions {
  readonly computerName?: string;
  readonly enabled: boolean;
  readonly salt?: () => string;
}

export class LinuxAuthentication {
  private state: AuthenticationState;
  private readonly computerName: string;
  private readonly salt: () => string;

  constructor(
    private readonly accounts: LinuxAccountDatabase,
    private readonly options: LinuxAuthenticationOptions,
  ) {
    this.computerName = options.computerName ?? "c-000000";
    this.salt = options.salt ?? randomSalt;
    if (!options.enabled) {
      this.state = this.disabledState();
      return;
    }
    this.state = this.loggedOutState();
  }

  get enabled(): boolean {
    return this.options.enabled;
  }

  get credentials(): ProcessCredentials | undefined {
    return this.state.kind === "authenticated" || this.state.kind === "disabled"
      ? this.state.credentials
      : undefined;
  }

  isAuthenticated(): boolean {
    return this.credentials !== undefined;
  }

  isSecretInput(): boolean {
    return (
      this.state.kind === "login-password" ||
      this.state.kind === "setup-confirm" ||
      this.state.kind === "setup-new"
    );
  }

  prompt(): string | undefined {
    switch (this.state.kind) {
      case "login-name":
        return `${this.computerName} login: `;
      case "login-password":
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
    return this.state.kind === "unavailable"
      ? ["CS-Linux login unavailable: account database is invalid."]
      : [];
  }

  submit(value: string): LinuxAuthenticationResult {
    switch (this.state.kind) {
      case "authenticated":
      case "disabled":
        return result(false, "", "", 0);
      case "unavailable":
        return result(true, "", "login: account database is unavailable\n", 1);
      case "setup-new":
        return this.acceptNewPassword(value, this.state.username);
      case "setup-confirm":
        return this.confirmNewPassword(
          value,
          this.state.candidate,
          this.state.username,
        );
      case "login-name":
        return this.acceptLoginName(value, this.state.failures);
      case "login-password":
        return this.authenticate(
          this.state.username,
          value,
          this.state.failures,
        );
    }
  }

  logout(): void {
    this.state = this.options.enabled
      ? this.loggedOutState()
      : this.disabledState();
  }

  verifyUserPassword(username: string, password: string): boolean {
    const shadow = this.accounts.getShadowRecord(username);
    if (shadow?.state !== "hash") return false;
    return verifyPassword(password, `${username}:${shadow.password}`);
  }

  setUserPassword(username: string, password: string): void {
    const problem = validatePassword(password);
    if (problem !== undefined) throw new Error(problem);
    const salt = this.salt();
    if (!/^[A-Za-z0-9_-]{16,32}$/u.test(salt))
      throw new Error("password salt is unavailable");
    this.accounts.setPasswordRecord(
      username,
      createPasswordPayload(password, salt),
    );
  }

  credentialsForUser(username: string): ProcessCredentials {
    const user = this.accounts.getUser(username);
    if (user === undefined)
      throw new Error(`unknown CS-Linux user: ${username}`);
    return credentialsForAccount(this.accounts, user);
  }

  private loggedOutState(): AuthenticationState {
    const initialUser = this.accounts.getUserByUid(initialUserId);
    const initialShadow =
      initialUser === undefined
        ? undefined
        : this.accounts.getShadowRecord(initialUser.name);
    return initialUser !== undefined && initialShadow?.state === "unset"
      ? { kind: "setup-new", username: initialUser.name }
      : { failures: 0, kind: "login-name" };
  }

  private disabledState(): AuthenticationState {
    const serviceUser = this.accounts.getUserByUid(initialUserId);
    return serviceUser === undefined
      ? { kind: "unavailable" }
      : {
          credentials: credentialsForAccount(this.accounts, serviceUser),
          kind: "disabled",
        };
  }

  private acceptLoginName(
    username: string,
    failures: number,
  ): LinuxAuthenticationResult {
    const normalized = /^[a-z_][a-z0-9_-]{0,31}$/u.test(username)
      ? username
      : "";
    this.state = {
      failures,
      kind: "login-password",
      username: normalized,
    };
    return result(true, "", "", 0);
  }

  private acceptNewPassword(
    password: string,
    username: string,
  ): LinuxAuthenticationResult {
    const problem = validatePassword(password);
    if (problem !== undefined)
      return result(true, "", `passwd: ${problem}\n`, 1);
    this.state = { candidate: password, kind: "setup-confirm", username };
    return result(true, "", "", 0);
  }

  private confirmNewPassword(
    password: string,
    candidate: string,
    username: string,
  ): LinuxAuthenticationResult {
    if (!constantTimeEqual(password, candidate)) {
      this.state = { kind: "setup-new", username };
      return result(
        true,
        "",
        "passwd: passwords do not match; start again\n",
        1,
      );
    }
    const salt = this.salt();
    if (!/^[A-Za-z0-9_-]{16,32}$/u.test(salt)) {
      this.state = { kind: "setup-new", username };
      return result(true, "", "passwd: password salt is unavailable\n", 1);
    }
    try {
      this.accounts.setPasswordRecord(
        username,
        createPasswordPayload(candidate, salt),
      );
    } catch (error: unknown) {
      this.state = this.loggedOutState();
      return result(
        true,
        "",
        `passwd: ${error instanceof Error ? error.message : String(error)}\n`,
        1,
      );
    }
    this.state = {
      credentials: this.credentialsForUser(username),
      kind: "authenticated",
    };
    return result(true, "Password configured.\n", "", 0, {
      kind: "password-configured",
      username,
    });
  }

  private authenticate(
    username: string,
    password: string,
    failures: number,
  ): LinuxAuthenticationResult {
    if (this.verifyUserPassword(username, password)) {
      this.state = {
        credentials: this.credentialsForUser(username),
        kind: "authenticated",
      };
      return result(true, "", "", 0, {
        kind: "login-success",
        username,
      });
    }
    const nextFailures = failures + 1;
    this.state = {
      failures: nextFailures >= 3 ? 0 : nextFailures,
      kind: "login-name",
    };
    if (nextFailures >= 3) {
      return {
        ...result(
          true,
          "",
          "Login incorrect\nToo many attempts; retrying in 2 seconds.\n",
          1,
          { kind: "login-failure", username: username || "unknown" },
        ),
        sleepTicks: 40,
      };
    }
    return result(true, "", "Login incorrect\n", 1, {
      kind: "login-failure",
      username: username || "unknown",
    });
  }
}

export function createPasswordPayload(password: string, salt: string): string {
  let digest = sha256Hex(`${salt}:${password}`);
  for (let iteration = 1; iteration < rounds; iteration += 1) {
    digest = sha256Hex(`${salt}:${digest}`);
  }
  return `${algorithm}:${String(rounds)}:${salt}:${digest}`;
}

export function createPasswordRecord(
  password: string,
  salt: string,
  username = initialUserName,
): string {
  return `${username}:${createPasswordPayload(password, salt)}`;
}

export function verifyPassword(password: string, encoded: string): boolean {
  const parsed = parsePasswordRecord(encoded);
  if (parsed === undefined) return false;
  return constantTimeEqual(
    createPasswordPayload(password, parsed.salt),
    parsed.payload,
  );
}

export function validatePassword(password: string): string | undefined {
  if ([...password].length < minimumPasswordCharacters)
    return `password must contain at least ${String(minimumPasswordCharacters)} characters`;
  if (utf8ByteLength(password) > maximumPasswordBytes)
    return `password must not exceed ${String(maximumPasswordBytes)} UTF-8 bytes`;
  if (/\0|[\r\n]/u.test(password))
    return "password contains an invalid control character";
  return undefined;
}

function credentialsForAccount(
  accounts: LinuxAccountDatabase,
  user: LinuxUserRecord,
): ProcessCredentials {
  return createLoginCredentials({
    groupId: user.gid,
    loginName: user.name,
    supplementaryGroupIds: accounts
      .groupsForUser(user.name)
      .map(({ gid }) => gid)
      .filter((gid) => gid !== user.gid),
    userId: user.uid,
  });
}

function parsePasswordRecord(
  encoded: string,
): { readonly payload: string; readonly salt: string } | undefined {
  const normalized = encoded.trim();
  const match =
    /^(?:[a-z_][a-z0-9_-]{0,31}:)?(cs-sha256-v1:512:([A-Za-z0-9_-]{16,32}):[0-9a-f]{64})$/u.exec(
      normalized,
    );
  return match === null
    ? undefined
    : { payload: match[1] ?? "", salt: match[2] ?? "" };
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
  audit?: LinuxAuthenticationAudit,
): LinuxAuthenticationResult {
  return {
    exitCode,
    handled,
    stderr,
    stdout,
    ...(audit === undefined ? {} : { audit }),
  };
}
