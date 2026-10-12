#!/bin/bash
# Read-only snapshot of the protected state on both ends. Usage: snapshot.sh <outdir>
# Phone reads go through the pin (reads may be loose, but the pin makes the target explicit).
set -uo pipefail
OUT="$1"; mkdir -p "$OUT"
REPO=/Users/chetan/Desktop/ConnectSuite
PKG=com.chetan.connectsuite.debug
A() { "$REPO/scripts/adb-pinned.sh" samsung "$@" 2>/dev/null; }

# --- phone: permissions, secure-setting bindings, app ops
A shell dumpsys package $PKG | grep -E "android.permission.[A-Z_]+: granted=" | sed 's/^ *//' | sort -u > "$OUT/phone-perms.txt"
{ echo "listeners: $(A shell settings get secure enabled_notification_listeners | tr -d '\r')"
  echo "a11y: $(A shell settings get secure enabled_accessibility_services | tr -d '\r')"; } > "$OUT/phone-bindings.txt"
# --- phone: preferences and DataStore (hash only; values are the owner's)
for f in shared_prefs/android.app.ActivityThread.IDS.xml shared_prefs/com.google.mlkit.internal.xml shared_prefs/connectsuite_identity.xml shared_prefs/connectsuite_onboarding.xml shared_prefs/sidekick_setup.xml files/datastore/connectsuite_settings.preferences_pb; do
  A shell "run-as $PKG sha256sum $f" | tr -d '\r'
done > "$OUT/phone-prefs.txt"
A shell "run-as $PKG ls shared_prefs files/datastore" | tr -d '\r' > "$OUT/phone-prefs-names.txt"
# --- phone: pairing, read through the engine with the WAL (CLAUDE.md: never the main file alone)
DB="$OUT/db"; mkdir -p "$DB"
for f in connectsuite.db connectsuite.db-wal connectsuite.db-shm; do
  A exec-out run-as $PKG cat databases/$f > "$DB/$f" || true
done
sqlite3 "file:$DB/connectsuite.db?mode=ro" "select name, type, fingerprint from trusted_devices order by name;" > "$OUT/phone-trust.txt" 2>&1 || true
rm -rf "$DB"
# --- phone: receive folder, every entry with size and mtime
A shell 'ls -la --time-style=+%s /sdcard/Download/ConnectSuite/ 2>/dev/null || ls -la /sdcard/Download/ConnectSuite/' | tr -d '\r' | awk 'NR>1' | sort -k7 > "$OUT/phone-receive.txt"
A shell 'ls -la /sdcard/Download/ConnectSuite/ | grep -cE "\.(failed|part|pending)"' | tr -d '\r' > "$OUT/phone-receive-markers.txt"

# --- Mac: receive folder (hidden entries included), app support, each with size, mtime, inode, sha256
mac_inv() {
  find "$@" -type f 2>/dev/null | sort | while IFS= read -r f; do
    printf '%s %s %s %s %s\n' "$(shasum -a 256 "$f" | cut -c1-64)" "$(stat -f %z "$f")" "$(stat -f %m "$f")" "$(stat -f %i "$f")" "$f"
  done
}
SUP="$HOME/Library/Application Support/sidekick-desktop"
mac_inv "$HOME/Downloads/Sidekick" "$SUP/pull-resume" "$SUP/identity" "$SUP/dev-share-receive" \
  "$SUP/sidekick.json" "$SUP/share-temporary-files.json" "$SUP/legacy-migration.json" > "$OUT/mac-inventory.txt"
wc -l < "$OUT/mac-inventory.txt" | tr -d ' ' > "$OUT/mac-inventory-count.txt"
echo "snapshot written to $OUT"
