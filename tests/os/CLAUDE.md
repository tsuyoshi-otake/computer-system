# Guest OS test guidance

- This scope owns Linux/DOS profile behavior, images, accounts, DAC, auth,
  shell, runtime presence, virtual files/devices, DOS FAT state/batch, and
  shell-visible assembler/compiler/debugger integration.
- Authentication uses deterministic salts/inputs and proves plaintext never
  enters shadow payloads, terminal output, logs, history, completion, snapshots,
  or MCP responses. Cover locked root, wrong/empty input, cancel/disconnect, and
  elevation cleanup.
- Bind the protected boot service to UID 1000, not the literal `cs` name. Cover
  rename/home move, same-name reuse, inactive-only mutation, missing home
  fallback, login-disabled reset, and complete idempotent `computer` migration.
- DAC tests cover ancestor traversal, owner/group/other, supplementary groups,
  sticky directories, protected hard links, ownership/mode changes, `umask`,
  managed account-file protection, sudo/su restoration, and bypass attempts from
  shell, editor, compiler, Python, startup, and MCP.
- DOS tests preserve case-insensitive strict 8.3, CRLF, drive-relative CWD, FAT
  timestamps/attributes/labels, media generations, absent A:, and DOS-only text.
  Multi-operand/wildcard mutations trial then commit or roll back as one unit,
  including async rejection and disguised-Promise quarantine.
- Shell-visible frontend/profile diagnostics live here; raw object, IR, linker,
  allocator, debugger-process, and execution mechanics live in `tests/runtime`.

## Focused verification

Run `npm test -- tests/os`. Production authentication also requires
`npm run test:mcp:bds` and the documented `linux_authentication/PASS` evidence.
