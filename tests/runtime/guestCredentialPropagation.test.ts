import { describe, expect, it } from "vitest";

import { credentialedFilesystem } from "../../src/application/os/credentialedFilesystem.js";
import { initialUserCredentials } from "../../src/application/os/linuxCredentials.js";
import { ShellSession } from "../../src/application/os/shellSession.js";
import { createNativeEnvironment } from "../../src/application/runtime/nativeModules.js";
import { createPythonCs486Program } from "../../src/application/runtime/pythonCs486.js";
import { InMemoryFilesystem } from "../../src/domain/filesystem/inMemoryFilesystem.js";
import { TerminalBuffer } from "../../src/domain/terminal/terminalBuffer.js";

describe("guest credential propagation", (): void => {
  it("uses the process view for native fs ownership, permissions, and umask", (): void => {
    const filesystem = linuxFixture();
    const guest = credentialedFilesystem(
      filesystem,
      initialUserCredentials,
      0o027,
    );
    const environment = nativeEnvironment(filesystem, guest);
    const process = createPythonCs486Program({
      environment,
      filesystem: guest,
      memoryBytes: 1_048_576,
      path: "/sandbox/main.py",
      source: 'import fs\nfs.write_file("/sandbox/result.txt", "ok")\n',
    }).process;

    run(process);

    expect(process.state).toEqual({ kind: "completed", value: null });
    expect(filesystem.readFile("/sandbox/result.txt")).toBe("ok");
    expect(filesystem.getMetadata("/sandbox/result.txt")).toMatchObject({
      gid: 1_000,
      mode: 0o640,
      uid: 1_000,
    });
  });

  it("denies native fs reads and Python imports outside the process DAC", (): void => {
    const filesystem = linuxFixture();
    filesystem.writeFile("/sandbox/secret.txt", "classified");
    filesystem.setMetadata("/sandbox/secret.txt", {
      gid: 0,
      mode: 0o600,
      uid: 0,
    });
    filesystem.writeFile("/sandbox/hidden.py", "value = 42\n");
    filesystem.setMetadata("/sandbox/hidden.py", {
      gid: 0,
      mode: 0o600,
      uid: 0,
    });
    const guest = credentialedFilesystem(filesystem, initialUserCredentials);
    const environment = nativeEnvironment(filesystem, guest);
    const read = createPythonCs486Program({
      environment,
      filesystem: guest,
      memoryBytes: 1_048_576,
      path: "/sandbox/read.py",
      source: 'import fs\nfs.read_file("/sandbox/secret.txt")\n',
    }).process;

    run(read);

    expect(read.state.kind).toBe("crashed");
    if (read.state.kind === "crashed") {
      expect(read.state.error.typeName).toBe("FilesystemError");
      expect(read.state.error.message).toContain("Permission denied");
    }
    expect(() =>
      createPythonCs486Program({
        environment,
        filesystem: guest,
        memoryBytes: 1_048_576,
        path: "/sandbox/import.py",
        source: "import hidden\n",
      }),
    ).toThrow(/Permission denied/u);
  });

  it("requires an explicit guest view for authenticated Linux native code", (): void => {
    expect(() =>
      createNativeEnvironment({
        computerId: 1,
        filesystem: new InMemoryFilesystem(),
        osProfile: "linux",
        requireLinuxLogin: true,
        terminal: new TerminalBuffer(),
      }),
    ).toThrow(/require a guest filesystem/u);
  });

  it("rejects split import and native filesystem authority", (): void => {
    const filesystem = linuxFixture();
    const guest = credentialedFilesystem(filesystem, initialUserCredentials);
    const environment = nativeEnvironment(filesystem, guest);

    expect(() =>
      createPythonCs486Program({
        environment,
        filesystem: credentialedFilesystem(filesystem, initialUserCredentials),
        memoryBytes: 1_048_576,
        path: "/sandbox/main.py",
        source: "pass\n",
      }),
    ).toThrow(/must share one guest filesystem/u);
  });
});

function linuxFixture(): InMemoryFilesystem {
  const filesystem = new InMemoryFilesystem();
  filesystem.setMetadata("/", { gid: 0, mode: 0o755, uid: 0 });
  filesystem.makeDirectory("/sandbox");
  filesystem.setMetadata("/sandbox", { gid: 1_000, mode: 0o700, uid: 1_000 });
  return filesystem;
}

function nativeEnvironment(
  filesystem: InMemoryFilesystem,
  guestFilesystem: ReturnType<typeof credentialedFilesystem>,
): ReturnType<typeof createNativeEnvironment> {
  const shell = new ShellSession(new InMemoryFilesystem(), {
    osProfile: "dos",
  });
  return createNativeEnvironment({
    computerId: 1,
    filesystem,
    guestFilesystem,
    osProfile: "linux",
    shell,
    terminal: new TerminalBuffer(),
  });
}

function run(
  process: ReturnType<typeof createPythonCs486Program>["process"],
): void {
  for (
    let slices = 0;
    slices < 100 &&
    (process.state.kind === "ready" || process.hasPendingCpuCycles);
    slices += 1
  ) {
    process.runCpuSlice(100_000);
  }
}
