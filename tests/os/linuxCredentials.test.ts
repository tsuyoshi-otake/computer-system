import { describe, expect, it } from "vitest";

import {
  CredentialContext,
  createEffectiveCredentials,
  createLoginCredentials,
  initialUserCredentials,
  isSuperuser,
  rootCredentials,
} from "../../src/application/os/linuxCredentials.js";

describe("Linux process credentials", (): void => {
  it("defines cs as the bounded initial administrator identity", (): void => {
    expect(initialUserCredentials).toEqual({
      effectiveGroupId: 1_000,
      effectiveUserId: 1_000,
      loginName: "cs",
      realGroupId: 1_000,
      realUserId: 1_000,
      savedGroupId: 1_000,
      savedUserId: 1_000,
      supplementaryGroupIds: [27],
    });
    expect(Object.isFrozen(initialUserCredentials)).toBe(true);
    expect(Object.isFrozen(initialUserCredentials.supplementaryGroupIds)).toBe(
      true,
    );
    expect(isSuperuser(initialUserCredentials)).toBe(false);
    expect(isSuperuser(rootCredentials)).toBe(true);
  });

  it("sorts, deduplicates, validates, and freezes supplementary groups", (): void => {
    const credentials = createLoginCredentials({
      groupId: 1_001,
      loginName: "builder",
      supplementaryGroupIds: [40, 27, 40, 10],
      userId: 1_001,
    });

    expect(credentials.supplementaryGroupIds).toEqual([10, 27, 40]);
    expect(Object.isFrozen(credentials.supplementaryGroupIds)).toBe(true);
    expect(() =>
      createLoginCredentials({
        groupId: 1_001,
        loginName: "Bad Name",
        userId: 1_001,
      }),
    ).toThrow(/login name/u);
    expect(() =>
      createLoginCredentials({
        groupId: 1_001,
        loginName: "builder",
        userId: 65_536,
      }),
    ).toThrow(/identity/u);
    expect(() =>
      createLoginCredentials({
        groupId: 1_001,
        loginName: "builder",
        supplementaryGroupIds: Array.from({ length: 33 }, (_, index) => index),
        userId: 1_001,
      }),
    ).toThrow(/group count/u);
  });

  it("changes only effective and saved identities for a sudo scope", (): void => {
    const elevated = createEffectiveCredentials(initialUserCredentials, {
      groupId: 0,
      loginName: "root",
      userId: 0,
    });

    expect(elevated.realUserId).toBe(1_000);
    expect(elevated.realGroupId).toBe(1_000);
    expect(elevated.effectiveUserId).toBe(0);
    expect(elevated.effectiveGroupId).toBe(0);
    expect(elevated.savedUserId).toBe(0);
    expect(elevated.savedGroupId).toBe(0);
    expect(isSuperuser(elevated)).toBe(true);
  });

  it("restores nested credential scopes after success and failure", (): void => {
    const builder = createLoginCredentials({
      groupId: 1_001,
      loginName: "builder",
      userId: 1_001,
    });
    const context = new CredentialContext(initialUserCredentials);

    expect(
      context.runWith(rootCredentials, (): string => {
        expect(context.current).toEqual(rootCredentials);
        return context.runWith(builder, (): string => {
          expect(context.current).toEqual(builder);
          return "done";
        });
      }),
    ).toBe("done");
    expect(context.current).toEqual(initialUserCredentials);

    expect(() =>
      context.runWith(rootCredentials, (): never => {
        throw new Error("scope failed");
      }),
    ).toThrow("scope failed");
    expect(context.current).toEqual(initialUserCredentials);
  });
});
