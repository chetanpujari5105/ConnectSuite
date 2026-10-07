# Defect 199 — `LinkService` killed by Android's `dataSync` time limit (2026-10-07)

Sanitized: our package's crash block only (other apps' entries in the same crash buffer were not
copied); IPs, certificate fingerprints and keys masked in every message field. No clipboard, contact,
call or message content.

| File | What it is |
|---|---|
| `crash-block.txt` | `logcat -b crash -d`, the one block for `com.chetan.connectsuite.debug` |
| `exit-info.txt` | `dumpsys activity exit-info` for the package, three most recent records |
| `phone-link-lines.txt` | the phone's `link.log`, timestamped lines only, 2026-10-06 23:23 → 2026-10-07 07:15 |
| `mac-link-lines.txt` | the Mac's `sidekick.log`, link and discovery lines 07:14:00 → 07:14:06 |

## Measured

- **Exception and component:** `android.app.RemoteServiceException$ForegroundServiceDidNotStopInTimeException:
  A foreground service of type dataSync did not stop within its timeout:
  ComponentInfo{com.chetan.connectsuite.debug/com.chetan.connectsuite.core.link.LinkService}`, main
  thread, 07:14:00.290. Exit record 07:14:00.300: `reason=4 (APP CRASH(EXCEPTION))`. Installed build
  `286e2b0` (`base.apk` `5f014e9e…30ad`). No app frame is in the trace — the platform throws it.
- **Runtime types:** `LinkService` declared `connectedDevice|dataSync`. Every start command re-claims;
  a `USER` start claimed `types=0x11` (connectedDevice | dataSync), every other reason `0x10`. Four
  `USER` claims between 23:28 and 23:57; the first three were each followed in the same millisecond
  by an `UNKNOWN` claim (`0x10`, `MainActivity.onResume`'s capability refresh), which dropped
  `dataSync`. **The last, at 23:57:05.383 (the re-pair), was not followed by any claim**, so
  `dataSync` was in force from then until the crash.
- **Restart and reconnect:** `Foreground claimed as UNKNOWN, types=0x10` at 07:14:01.789 (a
  `START_STICKY` restart: null intent), listeners up at .808, the listener rebind found it already
  listening. Mac: `Disconnected: phone closed the connection` 07:14:00.463, one `ECONNREFUSED`,
  `pairing: v2` and connected at 07:14:05.678. The service record kept its 23:23 creation time
  (`link-up.sh`: `createTime=-9h50m`), so the record outlived the process.

## Not established

- **When the six-hour budget began.** The platform resets it when the app comes to the foreground and
  this app does not log that. 23:57:05 + 6 h = 05:57, not 07:14, so the budget did not simply start
  at the last `dataSync` claim. Foreground use during stage D (01:11–01:42) followed by six hours is
  **consistent** with 07:14 and is **not** shown — a hypothesis, nothing more.
- Whether a `USER` claim's `dataSync` would have been dropped by a later capability refresh in
  ordinary use is irrelevant to the fix and was not pursued.

## Official guidance used

SDK 36.1 sources (`android/app/Service.java`): `onTimeout(int startId, int fgsType)` is called when a
type has timed out and gives "a small grace period of a few seconds" to `stopSelf()` /
`stopService()` / `stopForeground()`; the time limit is a rolling 24-hour window, reset "if the app
comes into the foreground state"; `startForeground`'s type "must be a subset" of the manifest's or
`IllegalArgumentException` is thrown. developer.android.com → *Foreground service timeouts*:
`dataSync` and `mediaProcessing`, 6 hours per 24 hours, Android 15+. *Foreground service types*:
`connectedDevice` — "interactions with external devices that require a … network connection", runtime
prerequisite one of `CHANGE_NETWORK_STATE` / `CHANGE_WIFI_STATE` / `CHANGE_WIFI_MULTICAST_STATE` /
`NFC` / `TRANSMIT_IR` declared (this app declares the first three), no time limit.
