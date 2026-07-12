export const defaultSystemBootSource = `
import os
import shell
shell.banner()
while True:
    shell.prompt()
    event = os.pull_event("terminal_line")
    shell.submit(event[1])
`;
