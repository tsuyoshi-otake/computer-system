import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");

describe("OS shell responsibility boundaries", (): void => {
  it("keeps command exposure out of the boot and path profile", async (): Promise<void> => {
    const source = await sourceFile("src/application/os/osProfile.ts");

    expect(source).not.toContain("aliases:");
    expect(source).not.toContain('["dir", "ls"]');
    expect(source).not.toContain('["copy", "cp"]');
  });

  it("uses explicit registries instead of a global default-allow list", async (): Promise<void> => {
    const runtime = await sourceFile("src/application/os/shellCommands.ts");
    const registry = await sourceFile("src/application/os/commandRegistry.ts");

    expect(runtime).not.toContain("shellCommandNames");
    expect(runtime).not.toContain("commandAvailable");
    expect(runtime).not.toContain("dispatchDosCommand");
    expect(registry).toContain("const linuxCommands");
    expect(registry).toContain("const dosCommands");
    expect(registry).toContain("new Map<string, string>()");
  });

  it("keeps Linux and DOS adapters from importing one another", async (): Promise<void> => {
    const dos = await sourceFile("src/application/os/dosCommands.ts");
    const dosFrontend = await sourceFile(
      "src/application/os/dosShellFrontend.ts",
    );
    const linuxFrontend = await sourceFile(
      "src/application/os/linuxShellFrontend.ts",
    );

    expect(dos).not.toMatch(/from ["'].*linux/iu);
    expect(dosFrontend).not.toMatch(/from ["'].*linux/iu);
    expect(linuxFrontend).not.toMatch(/from ["'].*dos/iu);
  });
});

async function sourceFile(relative: string): Promise<string> {
  return readFile(path.join(root, relative), "utf8");
}
