# Signing the Android APK yourself — 2026-10-14

**For the owner. Every command below is yours to run.** Signing is refused to agents by
`scripts/hooks/no-release-signing.sh`, and nothing in this file has been signed or installed by anyone.
Each fact is marked **verified** (read on this Mac today, with the command), **unverified**, or **assumed**.

Run the commands in your own Terminal, or in a Claude Code session by typing `!` before each line.

---

## 0. What you have today

| | | |
|---|---|---|
| The APK in the share folder | `Sidekick-2.0.1-android-UNSIGNED-bcb92ec.apk`, 5,316,240 bytes, SHA-256 `bbf8e9756fd0da506463c84b9991606ba5fff992f0b1c077b06a97407debe15b` — byte-identical to `~/.connectsuite-evidence-private/rc-bcb92ec/app-release-unsigned-bcb92ec.apk` | **verified** (`shasum -a 256` on both) |
| Its signature | none: `apksigner verify` → `DOES NOT VERIFY`, `ERROR: Missing META-INF/MANIFEST.MF` | **verified** |
| What it is | `com.chetan.connectsuite`, versionName `2.0.1`, versionCode `1`, no `android:debuggable`, already aligned (`zipalign -c -P 16 4` passes) | **verified** (`aapt2 dump`, `zipalign -c`) |
| Your release keystore | `~/.android-keystores/connectsuite-release.jks`, 4,436 bytes, mode `600`; the folder is mode `700` and carries a `.gitignore` of `*`. `connectsuite.properties` (101 bytes) sits beside it | **verified** — names, sizes and modes only. Neither file was opened |
| The certificate it signed with on 2026-09-29 | RSA 4096, SHA-256 `40470d0559821836be19d2edb9640336021c46b42ac8478dec68ac0b259f6ca8`, read from `app/build/outputs/apk/release/app-release.apk` | **verified** (`apksigner verify --print-certs`) |
| That the keystore still holds that same key | — | **unverified** — step 2 checks it |
| That a backup of the keystore exists | — | **unverified** — only you know |
| That no tester has an APK signed with this key | the share folder has only the unsigned APK; the docs record signed copies only on your own phone (2026-09-02) and in the build folder (2026-09-29) | **assumed** from the folder and the docs |

---

## 1. Decide first: keep this key, or make a new one

**Every update you ever ship must be signed with the same key.** A phone refuses an update signed by a
different key, so changing keys later means every tester uninstalls first — losing the pairing and what the
app holds on the phone. Today nobody else has an APK signed with it (assumed, above), so **today is the cheapest
day to change it, and the last cheap one.**

The one reason you might: the certificate's name fields include **your city and state**, and anyone holding
the APK can read them with one command (`apksigner verify --print-certs`). If you are fine with that being
public, keep the key and skip to step 2.

To make a new one instead (it asks for a password; choose a long one and put it in your password manager):

```sh
keytool -genkeypair -v \
  -keystore ~/.android-keystores/sidekick-release.jks -storetype PKCS12 \
  -alias sidekick -keyalg RSA -keysize 4096 -validity 10950 \
  -dname "CN=Sidekick"
```

`-validity 10950` is 30 years. `-dname` is what testers can read — put in it only what you want public.
If you make a new key, use its path and alias wherever this file says `connectsuite-release.jks` and
`<alias>`, and its fingerprint wherever it says `40470d05…`. Only the Gradle route (§3, last paragraph)
reads `connectsuite.properties`; the recommended route does not.

---

## 2. Where the keystore lives, and checking what is in it

**It lives in `~/.android-keystores/` and nowhere else on this Mac.** Not in the repository, not in the share
folder, not in Desktop or Documents, not in iCloud Drive or any synced folder as a plain file.

> **Unverified, and worth one look:** this account's iCloud settings list the *Desktop & Documents* data
> class as active, but iCloud Drive holds no Desktop or Documents folder. Check System Settings → your name →
> iCloud → iCloud Drive → *Desktop & Documents Folders*. It does not affect the keystore (it is in a hidden
> folder in your home), but the share folder is on the Desktop and the private progress log is in Documents.

**Back it up, twice, offline:** for example an encrypted USB stick and an encrypted disk image kept somewhere
else. Keep the password in your password manager, **not** next to the file.

- *Lost* → you can never ship an update; every tester uninstalls and reinstalls.
- *Leaked* → someone else can ship an "update" that installs over yours.

Check the keystore holds the key you expect. It asks for the keystore password and prints only the alias
and the fingerprint:

```sh
keytool -list -v -keystore ~/.android-keystores/connectsuite-release.jks | grep -E 'Alias name|SHA256:'
```

Expect `SHA256: 40:47:0D:05:59:82:18:36:BE:19:D2:ED:B9:64:03:36:02:1C:46:B4:2A:C8:47:8D:EC:68:AC:0B:25:9F:6C:A8`.
Write down the alias — the next step needs it. If the fingerprint is different, **stop**: the key on disk is
not the one the 2026-09-29 build used.

---

## 3. Sign

**Sign the exact file that was already checked** (release candidate `bcb92ec`), not a fresh build. Signing adds
a signature block and changes nothing inside the APK, so every check recorded for `bcb92ec` still describes it.
A new build would be new bytes that nobody has checked.

```sh
BT=~/Library/Android/sdk/build-tools/36.0.0
SHARE=~/Desktop/Sidekick-Beta-Share-2026-10-12
IN=~/.connectsuite-evidence-private/rc-bcb92ec/app-release-unsigned-bcb92ec.apk
OUT="$SHARE/Sidekick-2.0.1-android-bcb92ec.apk"

shasum -a 256 "$IN"
# must print bbf8e9756fd0da506463c84b9991606ba5fff992f0b1c077b06a97407debe15b — if not, stop

"$BT/apksigner" sign \
  --ks ~/.android-keystores/connectsuite-release.jks --ks-key-alias <alias> \
  --v4-signing-enabled false \
  --out "$OUT" "$IN"
```

- It asks `Keystore password for signer #1`, and a second time only if the key has its own password.
  **Never** pass the password on the command line (`--ks-pass pass:…`): it would stay in your shell history.
- `--v4-signing-enabled false` stops it writing a second file, `….apk.idsig`, which only `adb install --incremental`
  uses. Testers do not need it.
- The input is the copy in the private release-candidate folder, so the file you checked is never touched.

*The Gradle route*, for later releases rather than this one: `./gradlew -Pconnectsuite.signRelease=true
:app:assembleRelease` signs with the config in `~/.android-keystores/connectsuite.properties`. It builds new
bytes, so the release-candidate checks have to be run again on its output.

---

## 4. Check the signed APK

```sh
"$BT/apksigner" verify -v --print-certs "$OUT" 2>/dev/null \
  | grep -E '^Verifies|scheme v[23] .*: true|Number of signers|certificate SHA-256 digest'
```

Expect `Verifies`, at least one of v2/v3 `true`, `Number of signers: 1`, and the digest
`40470d0559821836be19d2edb9640336021c46b42ac8478dec68ac0b259f6ca8`.

```sh
"$BT/zipalign" -c -P 16 4 "$OUT" && echo aligned

diff <(unzip -v "$IN"  | awk 'NR>3 {print $7, $8}' | sort) \
     <(unzip -v "$OUT" | awk 'NR>3 {print $7, $8}' | sort) && echo "same files, same contents"
```

The `diff` compares every file's name and CRC-32 inside the two APKs. **Verified to run** today on two
copies of the unsigned APK (450 entries → `same files, same contents`). **Unverified** on a signed output:
for this app (`minSdkVersion 29`) `apksigner` should add no `META-INF` files, because it adds the old v1
scheme only below API 24. If the `diff` shows lines, read them before going on.

Then the new check — it reads every APK in the folder:

```sh
cd ~/Desktop/ConnectSuite
node scripts/check-share-apks.mjs "$SHARE" --expect-signer 40470d0559821836be19d2edb9640336021c46b42ac8478dec68ac0b259f6ca8
```

At this point it should print **`OK`** for the signed APK and still **`REFUSED`** for
`Sidekick-2.0.1-android-UNSIGNED-bcb92ec.apk` (unsigned), and exit 1. The next step removes that file.

---

## 5. Tidy the share folder

1. Remove the unsigned APK from the share folder (a byte-identical copy stays in `rc-bcb92ec`): drag
   `Sidekick-2.0.1-android-UNSIGNED-bcb92ec.apk` to the Bin.
2. In `README.txt`, under *For the Android phone*, change the file name to `Sidekick-2.0.1-android-bcb92ec.apk`.
   The sentence *"Neither app is signed by Apple or listed on Google Play"* stays true. Android may still say the
   app is from an unknown developer: signing does not change that (§7).
3. Run the check again. It should print `OK: 1 of 1 …` and exit 0.

---

## 6. Regenerate `SHA256SUMS.txt`

**After** editing `README.txt`, because the README is one of the files listed.

```sh
cd ~/Desktop/Sidekick-Beta-Share-2026-10-12
shasum -a 256 \
  Intel-untested/NOTE.txt Intel-untested/Sidekick-2.0.1.dmg README.txt \
  Sidekick-2.0.1-android-bcb92ec.apk Sidekick-2.0.1-arm64.dmg Sidekick-Beta-Tester-Guide.html \
  > SHA256SUMS.txt
shasum -a 256 -c SHA256SUMS.txt
```

Expect six lines ending `OK`. The list is today's file minus the unsigned APK, plus the signed one.

Then both folder checks:

```sh
cd ~/Desktop/ConnectSuite
node scripts/check-share-folder.mjs ~/Desktop/Sidekick-Beta-Share-2026-10-12
node scripts/check-share-apks.mjs  ~/Desktop/Sidekick-Beta-Share-2026-10-12 --expect-signer 40470d0559821836be19d2edb9640336021c46b42ac8478dec68ac0b259f6ca8
```

---

## 7. What signing does not settle

- **Only an install proves an install.** `Verifies` is a statement about the signature. Installing on a phone is
  your act (the hook refuses it to agents). If your phone still has the 2026-09-02 release install, `adb install -r`
  updates it only when the key is the same; with a new key, uninstall first.
- **Play Protect may still warn** that the app is from an unknown developer. Signing does not change that.
- **Android developer verification** (needed for installs on certified phones in some countries from 2026-09-30,
  everywhere in 2027, per `docs/release-audit-2026-10-06.md` P12) is a separate registration. Not covered here.
- **versionCode is still `1`.** The next release must raise it, or a phone refuses it as a downgrade or same
  version. Signing does not touch it.
- **The share folder holds more than testers need:** `graphics/`, `play-console-prep/`, `promo-video/`,
  `promo-video-v2/` (with Python environments and `node_modules`) and `Sidekick phone screenshots `. None of
  them is in `README.txt` or `SHA256SUMS.txt`. Decide whether they belong in what you send. A screenshot of your
  phone can show personal data.
