export const defaultSystemBootSource = `
import os
import shell
shell.banner()
while True:
    shell.prompt()
    event = os.pull_event()
    if event[0] == "terminal_line":
        shell.submit(event[1])
    elif event[0] == "terminal_keys":
        shell.keys(event[1])
`;
