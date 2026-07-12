import { describe, expect, it } from "vitest";
import { ShellSession } from "../../src/application/os/shellSession.js";
import { InMemoryFilesystem } from "../../src/domain/filesystem/inMemoryFilesystem.js";

describe("Computer System OS shell and editor", (): void => {
  it("lists and reads files and reports unknown commands", (): void => {
    const filesystem = new InMemoryFilesystem();
    filesystem.writeFile("/hello.py", "print('hi')");
    const shell = new ShellSession(filesystem);
    expect(shell.submit("ls /").lines[0]).toContain("hello.py");
    expect(shell.submit("cat /hello.py").lines).toEqual(["print('hi')"]);
    expect(shell.submit("wat").lines).toEqual(["Unknown command: wat"]);
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
});
