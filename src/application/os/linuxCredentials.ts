import { linuxAccountLimits } from "./linuxAccounts.js";

export const rootUserId = 0;
export const rootGroupId = 0;
export const initialUserName = "cs";
export const initialUserId = 1_000;
export const initialGroupId = 1_000;
export const sudoGroupId = 27;

const maximumLinuxId = 65_535;
const maximumSupplementaryGroups =
  linuxAccountLimits.maximumSupplementaryGroupsPerUser;
const loginNamePattern = /^[a-z_][a-z0-9_-]{0,31}$/u;

export interface ProcessCredentials {
  readonly effectiveGroupId: number;
  readonly effectiveUserId: number;
  readonly loginName: string;
  readonly realGroupId: number;
  readonly realUserId: number;
  readonly savedGroupId: number;
  readonly savedUserId: number;
  readonly supplementaryGroupIds: readonly number[];
}

export interface LoginIdentity {
  readonly groupId: number;
  readonly loginName: string;
  readonly supplementaryGroupIds?: readonly number[];
  readonly userId: number;
}

export interface EffectiveIdentity {
  readonly groupId: number;
  readonly loginName: string;
  readonly supplementaryGroupIds?: readonly number[];
  readonly userId: number;
}

export function createProcessCredentials(
  credentials: ProcessCredentials,
): ProcessCredentials {
  validateLoginName(credentials.loginName);
  for (const id of [
    credentials.realUserId,
    credentials.effectiveUserId,
    credentials.savedUserId,
    credentials.realGroupId,
    credentials.effectiveGroupId,
    credentials.savedGroupId,
  ]) {
    validateLinuxId(id);
  }
  const supplementaryGroupIds = normalizeSupplementaryGroups(
    credentials.supplementaryGroupIds,
  );
  return Object.freeze({
    ...credentials,
    supplementaryGroupIds,
  });
}

export function createLoginCredentials(
  identity: LoginIdentity,
): ProcessCredentials {
  return createProcessCredentials({
    effectiveGroupId: identity.groupId,
    effectiveUserId: identity.userId,
    loginName: identity.loginName,
    realGroupId: identity.groupId,
    realUserId: identity.userId,
    savedGroupId: identity.groupId,
    savedUserId: identity.userId,
    supplementaryGroupIds: identity.supplementaryGroupIds ?? [],
  });
}

export function createEffectiveCredentials(
  current: ProcessCredentials,
  target: EffectiveIdentity,
): ProcessCredentials {
  return createProcessCredentials({
    effectiveGroupId: target.groupId,
    effectiveUserId: target.userId,
    loginName: target.loginName,
    realGroupId: current.realGroupId,
    realUserId: current.realUserId,
    savedGroupId: target.groupId,
    savedUserId: target.userId,
    supplementaryGroupIds: target.supplementaryGroupIds ?? [],
  });
}

export function isSuperuser(credentials: ProcessCredentials): boolean {
  return credentials.effectiveUserId === rootUserId;
}

export const rootCredentials = createLoginCredentials({
  groupId: rootGroupId,
  loginName: "root",
  userId: rootUserId,
});

export const initialUserCredentials = createLoginCredentials({
  groupId: initialGroupId,
  loginName: initialUserName,
  supplementaryGroupIds: [sudoGroupId],
  userId: initialUserId,
});

/** Least-privilege identity used while no Linux login owns the shell. */
export const unauthenticatedCredentials = createLoginCredentials({
  groupId: 65_534,
  loginName: "nobody",
  userId: 65_534,
});

export class CredentialContext {
  private currentValue: ProcessCredentials;

  constructor(initial: ProcessCredentials) {
    this.currentValue = createProcessCredentials(initial);
  }

  get current(): ProcessCredentials {
    return this.currentValue;
  }

  replace(credentials: ProcessCredentials): void {
    this.currentValue = createProcessCredentials(credentials);
  }

  runWith<T>(credentials: ProcessCredentials, operation: () => T): T {
    const previous = this.currentValue;
    this.currentValue = createProcessCredentials(credentials);
    try {
      return operation();
    } finally {
      this.currentValue = previous;
    }
  }
}

function normalizeSupplementaryGroups(
  groupIds: readonly number[],
): readonly number[] {
  if (groupIds.length > maximumSupplementaryGroups) {
    throw new RangeError(
      `supplementary group count exceeds ${String(maximumSupplementaryGroups)}`,
    );
  }
  const normalized = [...new Set(groupIds)];
  for (const groupId of normalized) validateLinuxId(groupId);
  normalized.sort((left, right) => left - right);
  return Object.freeze(normalized);
}

function validateLinuxId(id: number): void {
  if (!Number.isSafeInteger(id) || id < 0 || id > maximumLinuxId) {
    throw new RangeError(`invalid Linux identity: ${String(id)}`);
  }
}

function validateLoginName(loginName: string): void {
  if (!loginNamePattern.test(loginName)) {
    throw new TypeError(`invalid Linux login name: ${loginName}`);
  }
}
