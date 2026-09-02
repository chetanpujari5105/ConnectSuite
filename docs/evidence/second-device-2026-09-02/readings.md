# Second device, 2026-09-02 — CPH1859 (realme 1), read-only + one refused install

Every row below is labelled with the handset it came from. Nothing on the SM-S938B was read, touched
or changed during this session; the Samsung was not on the USB bus at any point.

## Device

```
handset   CPH1859  ·  ro.oppo.market.name = "realme 1"
brand     OPPO (ro.product.brand)  ·  sub-brand Realme (ro.product.brand.sub)
release   Android 9      sdk 28      first_api_level 27
ColorOS   ro.build.version.opporom = V6.0
build     PPR1.180610.011 / CPH1859EX_11_C.50, built 2020-10-16
patch     2020-09-05
SoC       oppo6771_17065 (MediaTek Helio P60), arm64-v8a
users     0 Owner · 999 multiApp
display   1080x2160 @ 480dpi
```

## The install

| | |
|---|---|
| reading | `INSTALL_FAILED_OLDER_SDK: … Requires newer sdk version #29 (current version is #28)` |
| APK | `com.chetan.connectsuite.debug`, `minSdkVersion:'29'`, `targetSdkVersion:'36'` |
| control A (intended: prove the installer discriminates) | **FAILED TO DISCRIMINATE.** The release APK — which on the SM-S938B is refused with `INSTALL_PARSE_FAILED_NO_CERTIFICATES` (D13) — is refused here with the *same* `OLDER_SDK` string. The sdk check runs before signature verification, so this control proves the manifest parser runs and nothing more |
| control B (denominator) | 69 of 259 packages live under `/data/app` — the installer works on this device. **First attempt at this control returned `0` and was wrong**: `ls -d /data/app/*/` is refused to the shell uid. A missing reading, not a negative one; re-taken through `pm list packages -f` |
| control C | `pm list packages \| grep -c connectsuite` = 0, against 107 for `android` on the same query. Nothing partial left on the device |

## Provenance sweep — §2 of the audit, both handsets

| Component | SM-S938B | CPH1859 |
|---|---|---|
| SAF picker | `com.google.android.documentsui`, **`/data/app`**, Play-updated, versionName **17**, targetSdk 37 | `com.android.documentsui` = **`/system/priv-app/MtkDocumentsUI/MtkDocumentsUI.apk`**, versionName **9**, targetSdk 28, lastUpdate = ROM build date. **MediaTek's, frozen in the system image** |
| MediaStore | `com.google.android.providers.media.module`, **`/apex/com.android.mediaprovider/`** | `com.android.providers.media`, **`/system/priv-app/MediaProvider`**, versionName 1.50.0, targetSdk 27. **`/apex` does not exist on this device** |
| SAF tree provider | `com.android.externalstorage`, `/system/priv-app/` | `com.android.externalstorage`, `/system/priv-app/` — same name, different system image |
| Telephony provider | **`SecTelephonyProvider.apk`** (Samsung's, behind an AOSP package name) | **`TelephonyProvider.apk`** — no vendor prefix |
| Call log / contacts provider | `com.samsung.android.providers.contacts` | `com.android.providers.contacts` |
| Telecom | Samsung dialer + incallui | `com.android.server.telecom`, `com.android.incallui`, plus `OppoInCallService` in the framework |

## Other readings taken here

| Reading | Value | Note |
|---|---|---|
| Wi-Fi interface | `wlan0` (no `swlan0`); cellular is `ccmni0…ccmni20` (MediaTek naming, vs Qualcomm `rmnet*`) | Hotspot not up — hotspot iface naming needs a tap and was not taken |
| `settings get global wifi_on` | `0` — and here Wi-Fi genuinely **is** off; the phone is on mobile data via `ccmni2 10.111.205.179/8` | Same reading as the Samsung's hotspot lookalike, opposite cause |
| Clone user | user **999 `multiApp`** exists | ColorOS has one too, at a different id from Samsung's 95 |
| `am get-standby-bucket` | works. `com.android.settings` 5, `com.android.contacts` 5, `com.coloros.phonemanager` 5, `com.google.android.contacts` 40, `com.phonepe.app` 40 — 5 of 5 returned | `5` is not an AOSP bucket constant (10/20/30/40/45/50). Raw reading, uninterpreted |
| `am set-standby-bucket` | present and argument-parsing (`IllegalArgumentException: Argument expected`), **not refused** | On the SM-S938B `… 5` is refused, which is why Phase 6's unexempt path is out of scope there. Whether it *succeeds* here is untested — it needs our own package to aim at |
| Framework modification | `OppoActivityManagerService` appears in an AMS stack trace; `OppoAppFreezeService`, `OppoAutoClearService`, `OppoGuardElfService`, `OppoPowerMonitor` all resident | OPPO subclasses AMS. This is the Phase 6 surface, and it is a genuinely different one from One UI's |
| `content://mms-sms/conversations` via shell | **`SecurityException: … requires android.permission.READ_SMS`** to shell uid 2000 | On the SM-S938B the same shell query returned 2990 rows. Defect 50's *behavioural* comparison is unavailable here by either client |

## What could not be reached, and why

`SafProbeActivity`, `ClipProbeActivity`, `fs.list`, `media.list`, pairing, defect 17, and every
Phase 6 measurement require the app on the device. It cannot be installed. Nothing below the install
was attempted.
