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
    const shell = renderLinuxManualPage(linuxManualPage("cs-linux")!);
    expect(shell).toContain("fixed 4 KiB byte ring");
    expect(shell).toContain("|& connects stdout and stderr");
    expect(shell).toContain("Redirects are applied from left to right");
    expect(shell).toContain("probe 2>&1 >out");
    const less = renderLinuxManualPage(linuxManualPage("less")!);
    expect(less).toContain("COMMAND | less");
    expect(less).toContain("live pipe input");
    expect(less).toContain("SIGPIPE status 141");
    const more = renderLinuxManualPage(linuxManualPage("more")!);
    expect(more).toContain("COMMAND | more");
    expect(more).toContain("live pipe input");
    const python = renderLinuxManualPage(linuxManualPage("python")!);
    expect(python).toContain("persistent interactive session");
    expect(python).toContain("Ctrl+D exits");
    expect(python).toContain("process, PID, scheduler entry, or RAM grant");
    expect(linuxManualPage("micropython")).toBe(linuxManualPage("python"));
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
    expect(shell.submit("help").stdout).toContain(
      "|&  >  >>  <  2>  2>>  2>&1",
    );
    expect(shell.submit("man less").stdout).toContain("COMMAND | less");
    expect(shell.submit("man perl").stdout).toContain(
      "press Ctrl+D to run them or Ctrl+C to discard them",
    );
    expect(shell.submit("man python").stdout).toContain(
      "one validated CS486 process",
    );
    const dos = new ShellSession(new InMemoryFilesystem(), {
      osProfile: "dos",
    });
    expect(dos.submit("help").stdout).toContain("TYPE file | MORE");
    expect(dos.submit("help").stdout).toContain(
      "LESS, 2>, 2>>, 2>&1, and |& are not",
    );
    expect(dos.submit("help more").stdout).toContain(
      "sequential pipeline backed by strict-8.3 guest spools",
    );
    const apropos = shell.submit("apropos process");
    expect(apropos.exitCode).toBe(0);
    expect(apropos.stdout).toContain("ps (1)");
    expect(shell.submit("man absent")).toMatchObject({
      exitCode: 1,
      stderr: "man: no manual entry for absent\n",
    });
  });
});
