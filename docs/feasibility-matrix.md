# Bedrock feasibility matrix

Target environment: Minecraft Bedrock 1.26.30+, `@minecraft/server` 2.8.0, and
`@minecraft/server-ui` 2.1.0, without Beta APIs.

| Capability                            | Status                    | Evidence                                                                                                            | Production decision                                                                         |
| ------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Stable pack and script loading        | supported                 | GDK client recognized both packs and loaded the stable Script API bundle without Beta API experiments               | Keep stable module pins and validate on every Bedrock update                                |
| Instruction-budgeted runtime          | supported                 | Tester completed the in-game 20-computer runtime probe; host tests also prove equal 40-tick scheduling              | Start with 200 instructions per slice and 1,000 globally                                    |
| 51x19 terminal UI                     | supported_with_constraint | GDK client displayed all 19 fixed-width rows and live updates; input controls required vertical scrolling           | Use DDUI for the first vertical slice; prototype a denser production terminal view          |
| Terminal input and finalization       | supported_with_constraint | Live input mirrored `hello computer`; Submit cleared it; Terminate and Close ended as ServerClosed and ClientClosed | Map every close reason to an explicit VM result; retain bounded redraw and focus handling   |
| Connected monitor rendering and touch | pending                   | Monitor probe                                                                                                       | pending                                                                                     |
| Six-sided redstone input              | supported_with_constraint | BDS sampled power 15 independently from all six adjacent positions; `onRedstoneUpdate` emitted zero reliable events | Poll six neighbors at a bounded rate and synthesize change events                           |
| Independent digital redstone output   | supported_with_constraint | BDS verified all 64 face masks twice using redstone lamps                                                           | Generate 64 hidden fixed-output block types; swap type by mask                              |
| Independent analog output fallback    | not_supported             | One `minecraft:redstone_producer` exposes one common power value for its connected faces                            | Use Redstone Interface peripherals for independent analog channels                          |
| Persistent item and block identity    | supported_with_constraint | A non-stackable sword retained its Dynamic Property through chest storage, item-entity drop, and full BDS restart   | Computer and pocket items must be non-stackable; store block identity by dimension/location |
| World Dynamic Property persistence    | supported                 | BDS 1.26.33.2 advanced the sequence from 1 to 2 across a full server restart; both reads and writes passed          | Use world Dynamic Properties beneath the paged store                                        |
| Transactional paged storage           | supported                 | Automated tests prove page splitting, interrupted-write safety, integrity checks, and previous-generation recovery  | Use generation pages, a manifest, and an atomic head switch                                 |
| Pocket computer lifecycle             | pending                   | Item lifecycle probe                                                                                                | pending                                                                                     |
| Transactional turtle operations       | supported_with_constraint | BDS verified move, occupied rejection, forced rollback, drop recovery, and adjacent container transfer twice        | Use explicit transactions; reject unloaded destinations and add multiplayer conflict tests  |
| Pitched notes and registered sounds   | supported_with_constraint | BDS accepted two registered-sound calls at pitches 0.5 and 2.0                                                      | Keep registered sounds; human audibility and timing remain manual                           |
| Arbitrary PCM or DFPWM audio          | not_supported             | Stable sound APIs select registered sound identifiers and expose only pitch/volume                                  | Do not promise arbitrary streaming; ship a bounded registered sound palette                 |

Statuses are `supported`, `supported_with_constraint`, `not_supported`, or
`pending`. Every non-green capability must have a documented fallback before a
production phase depends on it.

The redstone output implementation deliberately avoids custom block states.
Those states still require the Holiday Creator Features experiment in the stable
Bedrock documentation. Computer System instead generates 64 internal block
identifiers (one per digital face mask), preserving the no-experiments baseline.
The visible resource and logical computer identity remain shared.

The GDK DDUI probe was verified at 1280x1024. Observable updates advanced while
the form remained open, but rapid label replacement occasionally produced a
partial frame during redraw. The production terminal must coalesce updates and
must not refresh its full label every scheduler slice.
