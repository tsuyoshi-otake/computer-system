import { describe, expect, it } from "vitest";

import { commandRegistryFor } from "../../src/application/os/commandRegistry.js";
import { ShellSession } from "../../src/application/os/shellSession.js";
import { InMemoryFilesystem } from "../../src/domain/filesystem/inMemoryFilesystem.js";
import {
  linuxManualPage,
  linuxManualPages,
  renderLinuxManualPage,
} from "../../src/application/os/linuxManual.js";

describe("CS-Linux manual metadata", (): void => {
  it("keeps every command page attached to an installed command", (): void => {
    const registry = commandRegistryFor("linux");
    for (const entry of linuxManualPages()) {
      if (
        entry.section !== 5 &&
        entry.name !== "cs-linux" &&
        entry.name !== "math" &&
        entry.name !== "nethack"
      )
        expect(registry.has(entry.name)).toBe(true);
      expect(linuxManualPage(entry.name.toUpperCase())).toBe(entry);
    }
  });

  it("renders bounded deterministic man-page text", (): void => {
    const entry = linuxManualPage("ps");
    expect(entry).toBeDefined();
    const rendered = renderLinuxManualPage(entry!);
    expect(rendered).toContain(
      "PS(1)\n\nNAME\n    ps - report guest process state",
    );
    expect(rendered).toContain("bounded OS process table");
    expect(rendered.length).toBeLessThan(4_096);
    const make = renderLinuxManualPage(linuxManualPage("make")!);
    expect(make).toContain("CS Make 1.0");
    expect(make).toContain("CSMAKE2 SHA-256");
    expect(make).toContain("begin after the make PID and 128 KiB lease");
    expect(make).toContain("one isolated guest command per scheduler tick");
    const git = renderLinuxManualPage(linuxManualPage("git")!);
    expect(git).toContain("CS System Git 1.0");
    expect(git).toContain("intentionally not interoperable with native Git");
    expect(git).toContain("1 MiB guest RAM lease");
    expect(git).toContain(
      "authenticated guest TCP/IP transport is not installed",
    );
    expect(git.length).toBeLessThan(4_096);
    const nethack = renderLinuxManualPage(linuxManualPage("nethack")!);
    expect(nethack).toContain("NETHACK(6)");
    expect(nethack).toContain("$HOME/.nethack.sav");
    expect(nethack).toContain("guest make, cc, and ld");
    const math = renderLinuxManualPage(linuxManualPage("math")!);
    expect(math).toContain("MATH(7)");
    expect(math).toContain("round-to-nearest ties-to-even");
    expect(math).toContain("never delegate to host libm");
  });

  it("serves man and apropos through installed sandbox utilities", (): void => {
    const shell = new ShellSession(new InMemoryFilesystem());
    const man = shell.submit("man ps");
    expect(man.exitCode).toBe(0);
    expect(man.stdout).toContain("PS(1)");
    expect(shell.submit("man 6 nethack").stdout).toContain("NETHACK(6)");
    expect(shell.submit("man 1 nethack")).toMatchObject({
      exitCode: 1,
      stderr: "man: no manual entry for nethack\n",
    });
    const apropos = shell.submit("apropos process");
    expect(apropos.exitCode).toBe(0);
    expect(apropos.stdout).toContain("ps (1)");
    expect(shell.submit("man absent")).toMatchObject({
      exitCode: 1,
      stderr: "man: no manual entry for absent\n",
    });
  });
});
