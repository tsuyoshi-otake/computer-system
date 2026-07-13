import { spawn } from "node:child_process";

export function openDefaultBrowser(url, options = {}) {
  const parsed = new URL(url);
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username.length > 0 ||
    parsed.password.length > 0
  ) {
    throw new Error("The browser URL must be an absolute HTTP(S) URL.");
  }

  const platform = options.platform ?? process.platform;
  const spawnProcess = options.spawnProcess ?? spawn;
  const launch = browserCommand(platform, parsed.href);
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnProcess(launch.command, launch.args, {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      });
    } catch (error) {
      reject(error);
      return;
    }
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve({ command: launch.command });
    });
  });
}

export function browserCommand(platform, url) {
  switch (platform) {
    case "win32":
      return {
        command: "rundll32.exe",
        args: ["url.dll,FileProtocolHandler", url],
      };
    case "darwin":
      return { command: "open", args: [url] };
    case "linux":
      return { command: "xdg-open", args: [url] };
    default:
      throw new Error(`Default browser opening is unsupported on ${platform}.`);
  }
}
