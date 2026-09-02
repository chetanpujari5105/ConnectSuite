# The version scheme

> One product, two apps, three numbers that mean different things. This says which is which and
> which one is *the* version. Written 2026-09-02, because until then nothing did.

## 0. The state this replaces

The Android app said `versionName = "1.0.0"` and the Mac app said `"version": "2.0.0"`. Both had
been there since their respective first commits, neither was wrong on its own, and **nothing in the
build reads both** — so the disagreement was invisible.

It is the shape `CLAUDE.md` keeps recording: a fact living in two places with nothing comparing
them. `scripts/check-versions.mjs` is the comparison, wired to `PreToolUse` on `git commit` beside
the defect, protocol-spec, clip-echo and renderer-view checks.

Aligning them was free on 2026-09-02 and will never be free again: an Android `versionCode` may
never go down, so the first release freezes both numbers into everybody's installed app.

## 1. The product version — `MAJOR.MINOR.PATCH`

**Currently `2.0.0`**, because v2 is what this codebase is. One string, in two files, and they must
be identical:

- `app/build.gradle.kts` → `versionName`
- `desktop/package.json` → `version`

What each part means here, since semver's contract is about an API and this is a pair of apps:

| Part | Bumped when |
|---|---|
| **MAJOR** | The two halves stop being able to talk to each other's previous release — in practice, when `Link.PROTOCOL_MAJOR` goes up |
| **MINOR** | A phase lands, or a feature a user would notice arrives |
| **PATCH** | Fixes and copy, with no new capability |

## 2. `versionCode` — Android's own integer, and nothing derives it

**A monotonic integer, bumped by hand, once per release.** It is not computed from the version name
and must not be.

The trap is worth naming because it is the standard advice: any `major*10000 + minor*100 + patch`
scheme breaks the first time a component reaches 100 — `2.9.0` → 20900 and `2.10.0` → 21000 works,
but `2.99.1` → 29901 and `2.100.0` → **30000** silently collides with `3.0.0`. Play then refuses an
upload after the release notes are written, and the only recovery is a version number nobody wanted.

The check asserts it is a positive integer and says the rule; it deliberately does not compute it.

## 3. `Link.PROTOCOL_MAJOR` — a third number, and it is not the product's

**Currently `1`.** It is the wire contract's compatibility generation and it changes when
`docs/protocol.md` changes in a way that breaks an older peer — not when the product ships.

Tying it to the product version would break in both directions: a copy fix would force a protocol
bump, and a genuine wire change would be blocked behind a product release. `check-versions.mjs`
therefore leaves it alone on purpose, and this paragraph is why, so that nobody "fixes" the
inconsistency later.

The relationship runs one way only: **a `PROTOCOL_MAJOR` bump implies a product MAJOR bump.** Not
the reverse.

## 4. Where a version is visible

| Surface | Reads |
|---|---|
| The Mac's packaged app | `CFBundleShortVersionString`, from `package.json` — the built `.dmg` is named `ConnectSuite-2.0.0-arm64.dmg` |
| The phone's `link.hello` | `LinkService.versionName()`, from `packageManager` |
| The Mac's Settings → About | `app.getVersion()` |
| The activity log | `ConnectSuite started · version 2.0.0` (R1) |

All four come from the two strings in §1. None is typed a second time.

## 5. Releasing — the order, once there is something to release

1. Decide the new product version (§1).
2. Set it in both files. `node scripts/check-versions.mjs` must pass.
3. Bump `versionCode` by one. Never reuse, never lower.
4. `cd desktop && npm run dist` → `desktop/release/`. Unsigned until there is an account; see
   `electron-builder.yml`'s header for exactly what changes on the day there is one.
5. `./gradlew :app:assembleRelease` → unsigned unless `keystore.properties` exists, which is
   deliberate: a missing keystore fails at install time rather than shipping a debug-signed APK.
6. Tag. Nothing publishes on a tag — `publish: null` is set explicitly for that reason.
