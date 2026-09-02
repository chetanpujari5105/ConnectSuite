# Predictions for the CPH1859 (realme 1), written BEFORE any install or probe

Written 2026-09-02. Everything above the line was known when this was written: the device was read
read-only via `adb getprop`, `pm list packages -f`, `dumpsys package`. Nothing was installed, and no
state on either handset was modified.

**Known at time of writing (readings, not predictions):**

- device `CPH1859` / market name `realme 1`, brand `OPPO`, sub-brand `Realme`
- `ro.build.version.release=9`, `ro.build.version.sdk=28`, ColorOS `ro.build.version.opporom=V6.0`
- security patch `2020-09-05`, build date `2020-10-16`
- app APK `com.chetan.connectsuite.debug`, `minSdkVersion:'29'`, `targetSdkVersion:'36'`
- `/apex` does not exist; DocumentsUI is `MtkDocumentsUI` in `/system/priv-app`

**Predictions, in the order I expect them to break:**

1. **The install is refused before pairing is ever reached.** `minSdk 29` against `sdk 28`. I expect
   `adb install` to fail with `INSTALL_FAILED_OLDER_SDK`, naming 29 and 28. Near-certain — it is
   arithmetic, not behaviour. The only thing being measured is the exact refusal string and the fact
   that nothing partial is left on the device.
2. **Defect 17 is therefore NOT tested by this handset.** The expected first wall was the Mac
   refusing a second phone. The real first wall is one layer earlier and on the phone side. I predict
   we finish this session with defect 17 in exactly the state it started in.
3. **Every §3.A SAF row stays `unknown, single-device`.** `SafProbeActivity` cannot run.
4. **Phase 6 is the one area where this device would have been most valuable and it is also
   unreachable** — `OppoAppFreezeService` / `OppoGuardElfService` / `OppoAutoClearService` are present
   and are exactly the second vendor Phase 6 needs.

**And the prediction that matters most — what a reading here would have been worth even if we could
install.** I predict that if `minSdk` were lowered to 28 to force this through, the two headline
comparisons would be *confounded rather than settled*:

- The `Download` / storage-root SAF refusal would **not** reproduce here, and NOT because MediaTek's
  picker differs from Google's. API 28 predates the restriction entirely (it arrives with scoped
  storage at API 30). A "Download is grantable on Realme" reading would be a fact about the API
  level, attributed to the vendor. That is this repo's lookalike failure with a second handset
  supplying the false confidence.
- The background-clipboard wall would likewise **not** reproduce, for the same reason: the
  restriction begins at Android 10, and this is Android 9.

So my prediction is that the surprise is not *what breaks* but *that the device is below the floor
where the audit's unknowns live* — it is a second vendor, but not a second reading of the same
question.
