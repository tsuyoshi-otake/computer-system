import { describe, expect, it } from "vitest";

import { ShellSession } from "../../src/application/os/shellSession.js";
import { InMemoryFilesystem } from "../../src/domain/filesystem/inMemoryFilesystem.js";

describe("bounded CS-Linux jq", (): void => {
  it("selects, iterates, collects, and renders guest JSON without host evaluation", (): void => {
    const filesystem = new InMemoryFilesystem();
    const shell = new ShellSession(filesystem, { osProfile: "linux" });
    filesystem.writeFile("/tmp/machine.json", '{"machine":"cs","ram":4}');
    const source =
      '{"items":[{"name":"alpha","level":"info"},{"name":"beta","level":"error"}]}';

    expect(
      shell.submit(
        `printf '${source}\\n' | jq -r '.items[] | select(.level == "error") | .name'`,
      ),
    ).toMatchObject({ exitCode: 0, stdout: "beta\n" });
    expect(
      shell.submit(`printf '${source}\\n' | jq '[.items[] | .name]'`),
    ).toMatchObject({ exitCode: 0, stdout: '["alpha","beta"]\n' });
    expect(shell.submit("jq -r .machine /tmp/machine.json")).toMatchObject({
      exitCode: 0,
      stdout: "cs\n",
    });
    expect(shell.submit("printf '[1,2,3]\\n' | jq length")).toMatchObject({
      exitCode: 0,
      stdout: "3\n",
    });
    expect(shell.submit('printf \'{"b":1,"a":2}\\n\' | jq keys')).toMatchObject(
      {
        exitCode: 0,
        stdout: '["a","b"]\n',
      },
    );
  });

  it("rejects malformed JSON and unsupported filters without partial output", (): void => {
    const shell = new ShellSession(new InMemoryFilesystem(), {
      osProfile: "linux",
    });

    const malformed = shell.submit("printf '{broken' | jq .");
    expect(malformed.exitCode).toBe(2);
    expect(malformed.stderr).toContain("jq: expected an object key");
    expect(malformed.stdout).toBe("");

    const unsupported = shell.submit("printf '[]' | jq 'map(.)'");
    expect(unsupported.exitCode).toBe(2);
    expect(unsupported.stderr).toContain("unsupported filter stage");
    expect(unsupported.stdout).toBe("");
  });
});
