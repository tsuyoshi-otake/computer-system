export const defaultSystemBootSource = `
import os
import shell
shell.banner()
shell.prompt()
while True:
    event = os.pull_event()
    if event[0] == "terminal_line":
        shell.submit(event[1])
        shell.prompt()
    elif event[0] == "terminal_keys":
        shell.keys(event[1])
        shell.prompt()
    elif event[0] == "terminal_eof":
        shell.eof()
        shell.prompt()
    elif event[0] == "terminal_mouse":
        shell.mouse(event[1])
        shell.prompt()
    elif event[0] == "terminal_closed":
        shell.disconnect()
        shell.prompt()
`;
