import { describe, expect, it } from "vitest";

import { runLinuxGitProbe } from "../../src/application/computer/linuxGitProbe.js";

describe("production CS-Linux Git probe", (): void => {
  it("completes the local workflow and explicitly finalizes its Computer", (): void => {
    expect(runLinuxGitProbe()).toMatchObject({
      committed: true,
      finalized: true,
      ignored: true,
      initialized: true,
      merged: true,
      remoteUnavailable: true,
      switched: true,
    });
  });
});
