import { EventEmitter } from "node:events";

import { describe, expect, it, vi } from "vitest";

import {
  browserCommand,
  openDefaultBrowser,
} from "../../tools/default-browser-opener.mjs";

describe("Default browser opener", () => {
  it("uses a shell-free Windows browser launch", async () => {
    const child = new EventEmitter();
    child.unref = vi.fn();
    const spawnProcess = vi.fn(() => {
      queueMicrotask(() => child.emit("spawn"));
      return child;
    });

    await expect(
      openDefaultBrowser("http://127.0.0.1:19144/p/abcdefghijkl", {
        platform: "win32",
        spawnProcess,
      }),
    ).resolves.toEqual({ command: "rundll32.exe" });
    expect(spawnProcess).toHaveBeenCalledWith(
      "rundll32.exe",
      ["url.dll,FileProtocolHandler", "http://127.0.0.1:19144/p/abcdefghijkl"],
      {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      },
    );
    expect(child.unref).toHaveBeenCalledOnce();
  });

  it("selects platform commands without a command shell", () => {
    expect(browserCommand("darwin", "https://localhost/p/code")).toEqual({
      command: "open",
      args: ["https://localhost/p/code"],
    });
    expect(browserCommand("linux", "https://localhost/p/code")).toEqual({
      command: "xdg-open",
      args: ["https://localhost/p/code"],
    });
    expect(() => browserCommand("plan9", "https://localhost/p/code")).toThrow(
      "Default browser opening is unsupported on plan9.",
    );
  });

  it("rejects non-HTTP browser targets", () => {
    expect(() => openDefaultBrowser("file:///tmp/terminal.html")).toThrow(
      "The browser URL must be an absolute HTTP(S) URL.",
    );
  });
});
