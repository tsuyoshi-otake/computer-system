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

  it("keeps bounded scalar totals through records into an END expression", (): void => {
    const session = new ShellSession(new InMemoryFilesystem(), {
      osProfile: "linux",
    });

    expect(
      session.submit(
        "printf 'alice 3\\nbob 4\\n' | awk '{ sum += $2; count++ } END { print sum, sum / count }'",
      ),
    ).toMatchObject({ exitCode: 0, stdout: "7 3.5\n" });
  });

  it("rejects one record beyond the configured bound", (): void => {
    const input = `${"x\n".repeat(linuxTextProcessorLimits.maximumRecords)}x\n`;
    const result = executeLinuxAwk(["{ print }"], input, () => "");

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("record count limit exceeded");
  });
});

describe("bounded CS-Linux search utilities", (): void => {
  it("matches alternation in grep and explicit rg files without a host scan", (): void => {
    const filesystem = new InMemoryFilesystem();
    const session = new ShellSession(filesystem, { osProfile: "linux" });
    filesystem.writeFile("/tmp/first.log", "ERROR first\ninfo\n");
    filesystem.writeFile("/tmp/second.log", "warn later\nWARN second\n");

    expect(
      session.submit("printf 'INFO\\nERROR\\nWARN\\n' | grep 'ERROR|WARN'"),
    ).toMatchObject({
      exitCode: 0,
      stdout: "ERROR\nWARN\n",
    });
    expect(
      session.submit("rg -in 'ERROR|WARN' /tmp/first.log /tmp/second.log"),
    ).toMatchObject({
      exitCode: 0,
      stdout:
        "/tmp/first.log:1:ERROR first\n/tmp/second.log:1:warn later\n/tmp/second.log:2:WARN second\n",
    });
    expect(
      session.submit("rg -l 'ERROR|WARN' /tmp/first.log /tmp/second.log"),
    ).toMatchObject({
      exitCode: 0,
      stdout: "/tmp/first.log\n/tmp/second.log\n",
    });
    expect(session.submit("rg -F 'ERROR|WARN' /tmp/first.log")).toMatchObject({
      exitCode: 1,
      stdout: "",
    });
  });
});

describe("practical CS-Linux text selections", (): void => {
  it("selects bounded character ranges and removes a bounded character set", (): void => {
    const session = new ShellSession(new InMemoryFilesystem(), {
      osProfile: "linux",
    });

    expect(session.submit("printf 'alphabet\\n' | cut -c 1,3-5")).toMatchObject(
      {
        exitCode: 0,
        stdout: "apha\n",
      },
    );
    expect(session.submit("printf 'abaac\\n' | tr -d ab")).toMatchObject({
      exitCode: 0,
      stdout: "c\n",
    });
    const invalidRange = session.submit("cut -c 5-3");
    expect(invalidRange.exitCode).toBe(2);
    expect(invalidRange.stderr).toContain("Usage:");
  });
});
