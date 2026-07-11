# Bedrock feasibility matrix

Target environment: Minecraft Bedrock 1.26.30+, `@minecraft/server` 2.8.0, and
`@minecraft/server-ui` 2.1.0, without Beta APIs.

| Capability                            | Status    | Evidence                                                                                                           | Production decision                                         |
| ------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| Stable pack and script loading        | pending   | Stable pack builds and deploys locally; in-game load is pending                                                    | pending                                                     |
| Instruction-budgeted runtime          | pending   | Host probe gives equal slices to 20 computers over 40 ticks; Bedrock probe is pending                              | pending                                                     |
| 51x19 terminal UI                     | pending   | DDUI probe                                                                                                         | pending                                                     |
| Terminal input and finalization       | pending   | DDUI probe                                                                                                         | pending                                                     |
| Connected monitor rendering and touch | pending   | Monitor probe                                                                                                      | pending                                                     |
| Six-sided redstone input              | pending   | Redstone probe                                                                                                     | pending                                                     |
| Independent digital redstone output   | pending   | Redstone probe                                                                                                     | pending                                                     |
| Independent analog output fallback    | pending   | Redstone Interface probe                                                                                           | pending                                                     |
| Persistent item and block identity    | pending   | Identity and reload probe                                                                                          | pending                                                     |
| Transactional paged storage           | supported | Automated tests prove page splitting, interrupted-write safety, integrity checks, and previous-generation recovery | Use generation pages, a manifest, and an atomic head switch |
| Pocket computer lifecycle             | pending   | Item lifecycle probe                                                                                               | pending                                                     |
| Transactional turtle operations       | pending   | Turtle probe                                                                                                       | pending                                                     |
| Pitched notes and registered sounds   | pending   | Speaker probe                                                                                                      | pending                                                     |
| Arbitrary PCM or DFPWM audio          | pending   | Speaker probe                                                                                                      | pending                                                     |

Statuses are `supported`, `supported_with_constraint`, `not_supported`, or
`pending`. Every non-green capability must have a documented fallback before a
production phase depends on it.
