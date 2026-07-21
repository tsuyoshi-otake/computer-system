import { describe, expect, it } from "vitest";

import { ShellSession } from "../../src/application/os/shellSession.js";
import {
  executeLinuxAwk,
  executeLinuxSed,
  linuxTextProcessorLimits,
} from "../../src/application/os/linuxTextProcessors.js";
import { InMemoryFilesystem } from "../../src/domain/filesystem/inMemoryFilesystem.js";

describe("bounded CS-Linux sed", (): void => {
  it("substitutes globally and supports selected printing", (): void => {
    const session = new ShellSession(new InMemoryFilesystem(), {
      osProfile: "linux",
    });

    expect(
      session.submit("printf 'alpha alpha\\nbeta\\n' | sed 's/alpha/A/g'"),
    ).toMatchObject({
      exitCode: 0,
      stdout: "A A\nbeta\n",
    });
    expect(
      session.submit("printf 'alpha\\nbeta\\n' | sed -n '/^b/p'"),
    ).toMatchObject({
      exitCode: 0,
      stdout: "beta\n",
    });
  });

  it("rejects malformed patterns without partial output", (): void => {
    const result = executeLinuxSed(["s/[z-a]/x/"], "z\n", () => "");

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("descending character range");
  });
});

describe("bounded CS-Linux awk", (): void => {
  it("reads fields and built-in NR/NF values", (): void => {
    const session = new ShellSession(new InMemoryFilesystem(), {
      osProfile: "linux",
    });

    const result = session.submit(
      "printf 'alice 3\\nbob 4\\n' | awk '/^b/ { print NR, $1, NF }'",
    );

    expect(result).toMatchObject({ exitCode: 0, stdout: "2 bob 2\n" });
  });

  it("supports BEGIN, record comparison, END, and bounded printf", (): void => {
    const result = executeLinuxAwk(
      [
        'BEGIN { print "start" } $1 == "x" { printf "%s:%d\\n", $1, NF } END { print "end" }',
      ],
      "x 2\ny 3\n",
      () => "",
    );

    expect(result).toEqual({
      exitCode: 0,
      stderr: "",
      stdout: "start\nx:2\nend\n",
    });
  });

  it("rejects one record beyond the configured bound", (): void => {
    const input = `${"x\n".repeat(linuxTextProcessorLimits.maximumRecords)}x\n`;
    const result = executeLinuxAwk(["{ print }"], input, () => "");

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("record count limit exceeded");
  });
});
