import type { InMemoryFilesystem } from "../../domain/filesystem/inMemoryFilesystem.js";

export interface ShellResult {
  readonly action?: "clear" | "reboot" | "shutdown";
  readonly lines: readonly string[];
}

export class ShellSession {
  private editor: { path: string; lines: string[] } | undefined;

  constructor(private readonly filesystem: InMemoryFilesystem) {}

  prompt(): string {
    return this.editor === undefined ? "> " : `edit:${this.editor.path}> `;
  }

  submit(line: string): ShellResult {
    if (this.editor !== undefined) return this.submitEditor(line);
    const [command = "", ...arguments_] = splitCommand(line);
    switch (command) {
      case "":
        return { lines: [] };
      case "help":
        return {
          lines: [
            "help clear ls cat edit shutdown reboot",
            "editor: .save .cancel .clear",
          ],
        };
      case "clear":
        return { action: "clear", lines: [] };
      case "ls":
        return this.list(arguments_[0] ?? "/");
      case "cat":
        return this.cat(arguments_[0]);
      case "edit":
        return this.edit(arguments_[0]);
      case "shutdown":
        return { action: "shutdown", lines: ["Shutting down"] };
      case "reboot":
        return { action: "reboot", lines: ["Rebooting"] };
      default:
        return { lines: [`Unknown command: ${command}`] };
    }
  }

  private list(path: string): ShellResult {
    try {
      return { lines: [this.filesystem.list(path).join("  ")] };
    } catch (error: unknown) {
      return { lines: [message(error)] };
    }
  }

  private cat(path: string | undefined): ShellResult {
    if (path === undefined) return { lines: ["Usage: cat <path>"] };
    try {
      return { lines: this.filesystem.readFile(path).split("\n") };
    } catch (error: unknown) {
      return { lines: [message(error)] };
    }
  }

  private edit(path: string | undefined): ShellResult {
    if (path === undefined) return { lines: ["Usage: edit <path>"] };
    try {
      const existing = this.filesystem.exists(path)
        ? this.filesystem.readFile(path)
        : "";
      this.editor = {
        path,
        lines: existing.length === 0 ? [] : existing.split("\n"),
      };
      return { lines: [`Editing ${path}; enter .save when finished`] };
    } catch (error: unknown) {
      return { lines: [message(error)] };
    }
  }

  private submitEditor(line: string): ShellResult {
    const editor = this.editor;
    if (editor === undefined) throw new Error("Editor state is unavailable");
    if (line === ".cancel") {
      this.editor = undefined;
      return { lines: ["Edit cancelled"] };
    }
    if (line === ".clear") {
      editor.lines.length = 0;
      return { lines: ["Buffer cleared"] };
    }
    if (line === ".save") {
      try {
        this.filesystem.writeFile(editor.path, editor.lines.join("\n"));
        this.editor = undefined;
        return { lines: [`Saved ${editor.path}`] };
      } catch (error: unknown) {
        return { lines: [message(error)] };
      }
    }
    editor.lines.push(line);
    return { lines: [] };
  }
}

function splitCommand(line: string): string[] {
  return line.trim().split(/\s+/u).filter(Boolean);
}
function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
