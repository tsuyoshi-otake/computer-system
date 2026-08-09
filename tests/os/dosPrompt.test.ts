import { describe, expect, it } from "vitest";

import { InMemoryFilesystem } from "../../src/domain/filesystem/inMemoryFilesystem.js";
import { ShellSession } from "../../src/application/os/shellSession.js";

describe("CS-DOS CHOICE and PAUSE terminal ownership", (): void => {
  it("keeps CHOICE key input active until a valid choice and exposes one prompt context", (): void => {
    const session = new ShellSession(new InMemoryFilesystem(), {
      osProfile: "dos",
    });

    const started = session.submit("CHOICE /C:YN Continue");
    expect(started).toMatchObject({
      exitCode: 0,
      stdout: "Continue [Y,N]?",
      terminalInput: true,
    });
    expect(session.prompt()).toBe("");
    expect(session.terminalInteraction()).toMatchObject({
      context: "dos-prompt",
      inputMode: "keys",
    });
    expect(session.submit("DIR")).toMatchObject({
      exitCode: 2,
      stderr: "COMMAND: key input is active; use a key or Ctrl+C.\r\n",
    });
    expect(session.terminalInteraction().context).toBe("dos-prompt");

    expect(session.keys(["X"])).toMatchObject({
      exitCode: 0,
      stdout: "\u0007",
      terminalInput: true,
    });
    expect(session.terminalInteraction().context).toBe("dos-prompt");

    expect(session.keys(["N"])).toMatchObject({
      exitCode: 2,
      stdout: "N\r\n",
    });
    expect(session.prompt()).toBe("C:\\> ");
  });

  it("continues a direct DOS command chain with the selected CHOICE status", (): void => {
    const session = new ShellSession(new InMemoryFilesystem(), {
      osProfile: "dos",
    });

    expect(
      session.submit("CHOICE /C:YN Continue || ECHO SELECTED"),
    ).toMatchObject({
      terminalInput: true,
    });
    expect(session.keys(["Y"])).toMatchObject({
      exitCode: 0,
      stdout: "Y\r\nSELECTED\r\n",
    });
    expect(session.terminalInteraction().context).toBe("shell");
  });

  it("resumes a bounded batch after CHOICE with its ERRORLEVEL and clears on cancel", (): void => {
    const filesystem = new InMemoryFilesystem();
    const session = new ShellSession(filesystem, { osProfile: "dos" });
    filesystem.writeFile(
      "/drives/c/ask.bat",
      [
        "@ECHO OFF",
        "CHOICE /C:YN Continue",
        "IF ERRORLEVEL 2 ECHO NO",
        "IF ERRORLEVEL 1 ECHO YES",
      ].join("\r\n"),
    );

    const started = session.submit("ASK");
    expect(started).toMatchObject({
      stdout: "Continue [Y,N]?",
      terminalInput: true,
    });
    const answered = session.keys(["N"]);
    expect(answered).toMatchObject({
      exitCode: 0,
      stdout: "N\r\nNO\r\n",
    });
    expect(session.terminalInteraction().context).toBe("shell");

    expect(session.submit("PAUSE")).toMatchObject({
      terminalInput: true,
    });
    expect(session.cancelTerminalInteraction()).toBe(true);
    expect(session.prompt()).toBe("C:\\> ");
    expect(session.keys(["Enter"])).toMatchObject({
      exitCode: 0,
      stdout: "",
    });
  });

  it("passes DOS standard output through a guest-owned TYPE to FIND pipeline", (): void => {
    const filesystem = new InMemoryFilesystem();
    const session = new ShellSession(filesystem, { osProfile: "dos" });
    filesystem.writeFile(
      "/drives/c/log.txt",
      "INFO startup\r\nERROR disk full\r\nWARN retry\r\n",
    );

    expect(session.submit('TYPE LOG.TXT | FIND /I "error"')).toMatchObject({
      exitCode: 0,
      stderr: "",
      stdout: "ERROR disk full\r\n",
    });
  });
});
