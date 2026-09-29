#!/bin/bash
#
# Fixtures for no-release-signing.sh. Run: scripts/hooks/no-release-signing.test.sh
#
# Each deny has a pass beside it that shares its words and differs in the one thing that matters —
# a verify instead of a sign, a debug APK instead of a release one, the flag in prose instead of on
# a command line. A matcher that only has denies is a matcher nobody has checked for overreach
# (defect 41 was exactly that).
set -uo pipefail

HOOK="$(dirname "$0")/no-release-signing.sh"
fail=0

check() {
  local expect="$1" name="$2" cmd="$3"
  local out
  out=$(printf '%s' "$cmd" | jq -Rs '{tool_input: {command: .}}' | "$HOOK" 2>/dev/null || true)
  local got="pass"
  printf '%s' "$out" | grep -q '"permissionDecision": *"deny"' && got="deny"
  if [ "$got" = "$expect" ]; then
    printf '  ok    %-60s (%s)\n' "$name" "$got"
  else
    printf '  FAIL  %-60s expected %s, got %s\n' "$name" "$expect" "$got"
    fail=1
  fi
}

echo "must be DENIED:"
check deny "gradlew with the signing flag" \
  './gradlew :app:assembleRelease -Pconnectsuite.signRelease=true'
check deny "flag first, JAVA_HOME prefix, chained" \
  'export JAVA_HOME=/x; cd /r && ./gradlew -Pconnectsuite.signRelease=true :app:bundleRelease && echo ok'
check deny "spaced -P form" \
  './gradlew -P connectsuite.signRelease=true :app:assembleRelease'
check deny "signingReport with the flag (reads the keystore)" \
  './gradlew -q -Pconnectsuite.signRelease=true :app:signingReport'
check deny "apksigner sign" \
  '"$BT/apksigner" sign --ks ~/.android-keystores/x.jks out.apk'
check deny "jarsigner signing" \
  'jarsigner -keystore k.jks app.apk alias'
check deny "a verify then a sign, chained (only the split sees the second)" \
  'jarsigner -verify a.apk; jarsigner -keystore k.jks b.apk alias'
check deny "quoted jarsigner path" \
  '"$JAVA_HOME/bin/jarsigner" -keystore k.jks b.apk alias'
check deny "notarytool submit" \
  'xcrun notarytool submit dist/Sidekick.dmg --wait'
check deny "stapler staple" \
  'xcrun stapler staple dist/Sidekick.dmg'
check deny "electron-builder --publish always" \
  'npx electron-builder --mac --publish always'
check deny "adb install of the release APK" \
  'adb install -r app/build/outputs/apk/release/app-release.apk'
check deny "release install through adb-pinned" \
  'scripts/adb-pinned.sh samsung install app/build/outputs/apk/release/app-release-unsigned.apk'

echo
echo "must PASS:"
check pass "unsigned assembleRelease (what the build now produces)" \
  './gradlew :app:assembleRelease'
check pass "signingReport without the flag" \
  './gradlew -q :app:signingReport'
check pass "apksigner verify --print-certs on the release APK" \
  '"$BT/apksigner" verify --verbose --print-certs app/build/outputs/apk/release/app-release.apk'
check pass "jarsigner -verify" \
  'jarsigner -verify -verbose app.apk'
check pass "electron-builder --publish never (npm run dist:dir)" \
  'npx electron-builder --mac --dir --publish never'
check pass "adb install of the debug APK" \
  'scripts/adb-pinned.sh samsung install -r app/build/outputs/apk/debug/app-debug.apk'
check pass "heredoc writing docs that name the flag" \
  "$(printf 'cat > docs/x.md <<%s\nrun ./gradlew -Pconnectsuite.signRelease=true :app:assembleRelease yourself\nEOF\n' "'EOF'")"
check pass "commit message naming the flag and apksigner sign" \
  'git commit -m "Build: signing needs -Pconnectsuite.signRelease=true; apksigner sign is refused" && git log -1'
check pass "grep for the flag in the build file" \
  'grep -n connectsuite.signRelease app/build.gradle.kts'
check pass "debug install, then an ls of the release APK (split keeps them apart)" \
  'scripts/adb-pinned.sh samsung install -r app/build/outputs/apk/debug/app-debug.apk; ls -la app/build/outputs/apk/release/app-release.apk'
check pass "unsigned gradle build, then echo of the flag's name" \
  './gradlew :app:assembleRelease; echo "signing would need -Pconnectsuite.signRelease=true"'
check pass "codesign -v and spctl -a on the Mac app" \
  'codesign -v --deep dist/mac/Sidekick.app; spctl -a -vv dist/mac/Sidekick.app'

echo
if [ "$fail" -eq 0 ]; then echo "all fixtures pass"; else echo "FIXTURES FAILED"; fi
exit "$fail"
