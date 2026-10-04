# Swift mutations — W3 correction A2 (2026-10-04)

Each mutation was applied to the source, the named suite run with `node run-tests.mjs --filter <suite>`
(a filtered run, recorded by the wrapper as not the suite), and the source restored before the next.

| | Mutation | Red on |
|---|---|---|
| MA1 | the AU is parsed before its session is decided (the old order) | `malformedBytesTaggedWithAnotherSessionCannotEndTheLiveOne` — garbage tagged with the buried S1 ended the live S2 |
| MA2 | a stream-rule violation (`StreamValidator.malformed`) is a drop, not fatal | `aGenerationThatDoesNotStartWithAnIDRIsFatalNotAWait`, `theFirstAUOfASessionMustBeAnIDR`, `aSequenceThatDoesNotIncreaseIsFatal` |
| MA3 | `BridgeCore` does not apply the reject's effects | `malformedAndOversizedInputIsRefusedBeforeItIsTrusted` — no `stream-rejected`, sink still `feeding`, and the device drew `.repeat` (the ended session's last frame) where the camera-off card belongs |

MA3's last line is the placeholder rule seen from the failing side: without the stop, the picture of a
session the Mac has stopped trusting stays on screen.
