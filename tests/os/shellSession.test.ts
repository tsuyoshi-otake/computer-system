import { describe, expect, it } from "vitest";
import { ShellSession } from "../../src/application/os/shellSession.js";
import { InMemoryFilesystem } from "../../src/domain/filesystem/inMemoryFilesystem.js";

describe("Computer System OS shell and editor", (): void => {
  it("lists and reads files and reports unknown commands", (): void => {
    const filesystem = new InMemoryFilesystem();
    filesystem.writeFile("/hello.py", "print('hi')");
    const shell = new ShellSession(filesystem);
    expect(shell.prompt()).toBe("~$ ");
    expect(shell.submit("ls /").lines[0]).toContain("hello.py");
    expect(shell.submit("cat /hello.py").lines).toEqual(["print('hi')"]);
    expect(shell.submit("wat").lines).toEqual(["bash: wat: command not found"]);
  });

  it("saves, cancels, and clears editor buffers explicitly", (): void => {
    const filesystem = new InMemoryFilesystem();
    const shell = new ShellSession(filesystem);
    expect(shell.submit("edit /startup.py").lines[0]).toMatch(/Editing/u);
    shell.submit("import redstone");
    shell.submit('print("ready")');
    expect(shell.submit(".save").lines).toEqual(["Saved /startup.py"]);
    expect(filesystem.readFile("/startup.py")).toBe(
      'import redstone\nprint("ready")',
    );
    shell.submit("edit /discarded.txt");
    shell.submit("discard me");
    shell.submit(".clear");
    shell.submit("replacement");
    shell.submit(".cancel");
    expect(filesystem.exists("/discarded.txt")).toBe(false);
  });

  it("returns explicit lifecycle actions", (): void => {
    const shell = new ShellSession(new InMemoryFilesystem());
    expect(shell.submit("shutdown").action).toBe("shutdown");
    expect(shell.submit("reboot").action).toBe("reboot");
    expect(shell.submit("clear").action).toBe("clear");
  });

  it("supports relative paths and BusyBox-style file commands", (): void => {
    const filesystem = new InMemoryFilesystem();
    const shell = new ShellSession(filesystem);

    expect(shell.submit("mkdir -p work/data").exitCode).toBe(0);
    expect(shell.submit("cd work").exitCode).toBe(0);
    expect(shell.submit("pwd").lines).toEqual(["/work"]);
    expect(shell.submit("touch data/empty").exitCode).toBe(0);
    expect(shell.submit("echo hello > data/message").lines).toEqual([]);
    expect(shell.submit("echo world >> data/message").exitCode).toBe(0);
    expect(shell.submit("cp data/message data/copy").exitCode).toBe(0);
    expect(shell.submit("mv data/copy data/moved").exitCode).toBe(0);
    expect(shell.submit("ls -la data").lines).toEqual([
      "file       0 empty",
      "file      12 message",
      "file      12 moved",
    ]);
    expect(shell.submit("rm data/moved").exitCode).toBe(0);
    expect(shell.submit("find . -name 'm*'").lines).toEqual([
      "/work/data/message",
    ]);
  });

  it("runs bounded pipelines and text filters", (): void => {
    const shell = new ShellSession(new InMemoryFilesystem());

    expect(
      shell.submit("printf 'pear\\napple\\npear\\n' | sort | uniq -c").lines,
    ).toEqual(["      1 apple", "      2 pear"]);
    expect(
      shell.submit("printf 'alpha\\nbeta\\nalpine\\n' | grep -n alp | wc -l")
        .lines,
    ).toEqual(["      2"]);
    expect(shell.submit("printf 'abc' | tr abc xyz").lines).toEqual(["xyz"]);
    expect(shell.submit("printf '1\\n2\\n3\\n' | tail -2").lines).toEqual([
      "2",
      "3",
    ]);
  });

  it("supports redirects, quotes, variables, exit status, and control operators", (): void => {
    const shell = new ShellSession(new InMemoryFilesystem());

    expect(shell.submit("NAME='computer system'").exitCode).toBe(0);
    expect(shell.submit('echo "$NAME"').lines).toEqual(["computer system"]);
    expect(shell.submit("false; echo $?").lines).toEqual(["1"]);
    expect(shell.submit("false && echo no || echo yes").lines).toEqual(["yes"]);
    expect(shell.submit("true || echo no; echo done").lines).toEqual(["done"]);
    expect(shell.submit("printf input > file; cat < file").lines).toEqual([
      "input",
    ]);
    expect(shell.submit("echo 'unterminated").exitCode).toBe(2);
    expect(shell.submit("echo 'unterminated").lines[0]).toMatch(
      /syntax error/u,
    );
  });

  it("executes sh and bash scripts inside the sandbox", (): void => {
    const filesystem = new InMemoryFilesystem();
    const shell = new ShellSession(filesystem);
    filesystem.writeFile(
      "/script.sh",
      "echo first\nprintf 'second\\n' | tr a-z A-Z\nfalse || echo recovered",
    );

    expect(shell.submit("bash --version").lines[0]).toMatch(
      /Computer System bash/u,
    );
    expect(shell.submit("sh /script.sh").lines).toEqual([
      "first",
      "SECOND",
      "recovered",
    ]);
    expect(shell.submit('bash -c "echo inline | wc -w"').lines).toEqual([
      "      1",
    ]);
  });
});
