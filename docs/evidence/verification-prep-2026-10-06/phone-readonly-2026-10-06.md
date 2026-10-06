# Phone read-only checks — 2026-10-06 22:26 IST

Through `scripts/adb-pinned.sh samsung` only. Nothing installed, granted, cleared, started or uninstalled.

| Reading | Value |
|---|---|
| Pin | `RZCY12330DT` = SM-S938B, Android 16, SDK 36 |
| Package | `com.chetan.connectsuite.debug` only (no release package) |
| versionCode / versionName | 1 / 2.0.0 (minSdk 29, targetSdk 36), `DEBUGGABLE` |
| firstInstallTime / **lastUpdateTime** | 2026-08-24 18:33:34 / **2026-10-04 17:08:34** — the installed build predates every phone commit since 2026-10-05 (S7 origin, pairing v2, S2b, S6, the log-privacy changes, `webcam.keyframe`) |
| Installed `base.apk` | SHA-256 `b0ad2a47a87e0356d39c8494b74f744f9cbe1fc2cf983c4d73951633f3e327f9`, 95,845,644 bytes; pulled as the rollback copy (session scratch, not in the repo) |
| Signer | installed `d3a505d2…7d26` = new APK `d3a505d2…7d26` → **same** |
| versionCode new vs installed | 1 vs 1 → `install -r` without `-d` |
| Declared permissions | identical sets (no `+`, no `-`) |
| Runtime grants, **user 0** | all 14 `granted=true`: ANSWER_PHONE_CALLS, CALL_PHONE, CAMERA, NEARBY_WIFI_DEVICES, POST_NOTIFICATIONS, READ_CALL_LOG, READ_CONTACTS, READ_MEDIA_IMAGES, READ_MEDIA_VIDEO, READ_MEDIA_VISUAL_USER_SELECTED, READ_PHONE_STATE, READ_SMS, RECEIVE_SMS, SEND_SMS |
| Other profiles | **user 95**: installed, nothing granted. **user 150**: not installed; the shell may not query it (`SecurityException … user 150` from `pm list packages`) — a protected profile, left alone |

**Instrument note.** The first pass printed each permission twice (`granted=false` and `granted=true`)
because its filter dropped the `User N:` headers and merged three profiles. Re-read with the headers kept;
the table is the disambiguated reading.

**Implication for A4.** An `adb install -r` updates the code for every profile that has the package (0 and
95); per-profile grants and install state are kept. The grants to re-check after A4 are user 0's 14.
