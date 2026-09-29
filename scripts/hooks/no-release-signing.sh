#!/bin/bash
#
# Refuses, from an agent's shell, every command that would sign, notarize or install a release build.
#
# 2026-09-29: `./gradlew :app:assembleRelease` was run to read what a release manifest contains, and
# it produced `app/build/outputs/apk/release/app-release.apk` signed with the owner's publishing key
# (cert SHA-256 40470d05…). Nobody asked for a signed artifact. The cause was not a command anyone
# typed wrong: `~/.android-keystores/connectsuite.properties` existed, and app/build.gradle.kts read
# it on every build. That half is fixed in the build — signing now needs
# `-Pconnectsuite.signRelease=true` on the command line, and no file can supply it.
#
# This hook is the other half. The flag is now the only road to a signature, so it is the one thing
# an agent must never type: signing is the owner's act, taken with the owner's approval, and a person
# can still run it with `! ./gradlew -Pconnectsuite.signRelease=true …` in the same session. The same
# goes for the tools that sign or notarize an artifact directly, and for installing a release APK on a
# device, which is how a signed build would reach somebody's phone.
#
# Matching follows no-force-stop.sh (defect 41), for the same reason: a hook that denies every
# command *mentioning* the rule forbids writing down the rule. So heredoc bodies and `-m` values are
# removed first, and the real invocation shape is required per command segment.
#
# Verifying a signature is not signing: `apksigner verify`, `jarsigner -verify`, `codesign -v`,
# `spctl -a` all pass. An unsigned `assembleRelease` passes too — it is what the build now produces.
set -euo pipefail

command=$(jq -r '.tool_input.command // ""')

executable=$(printf '%s' "$command" | awk '
  BEGIN { skipping = 0 }
  skipping == 1 {
    line = $0
    gsub(/^[ \t]+/, "", line)
    if (line == terminator) { skipping = 0 }
    next
  }
  {
    if (match($0, /<<-?[ \t]*['"'"'"]?[A-Za-z_][A-Za-z0-9_]*['"'"'"]?/)) {
      tag = substr($0, RSTART, RLENGTH)
      gsub(/^<<-?[ \t]*/, "", tag)
      gsub(/['"'"'"]/, "", tag)
      terminator = tag
      skipping = 1
    }
    print
  }
')
executable=$(printf '%s' "$executable" | sed -E \
  -e 's/(-m|--message)[ \t]+"[^"]*"/\1 <message>/g' \
  -e "s/(-m|--message)[ \t]+'[^']*'/\1 <message>/g")

reason=""
while IFS= read -r segment; do
  [ -z "$segment" ] && continue
  # 1. The opt-in, on any Gradle invocation. -P form, or a spaced `-P connectsuite.signRelease`.
  if printf '%s' "$segment" | grep -Eq '(gradlew|gradle)([[:space:]]|$)' &&
     printf '%s' "$segment" | grep -Eq -- '-P[[:space:]]*connectsuite\.signRelease'; then
    reason="release signing flag (-Pconnectsuite.signRelease)"; break
  fi
  # 2. apksigner's signing subcommand. `apksigner verify` is a read.
  #    The path is often quoted — `"$BT/apksigner" sign` — so a quote may sit on either side.
  if printf '%s' "$segment" | grep -Eq "(^|[/[:space:]\"'])apksigner[\"']?[[:space:]]+sign([[:space:]]|\$)"; then
    reason="apksigner sign"; break
  fi
  # 3. jarsigner signs unless told to verify.
  if printf '%s' "$segment" | grep -Eq "(^|[/[:space:]\"'])jarsigner[\"']?([[:space:]]|\$)" &&
     ! printf '%s' "$segment" | grep -Eq -- '-verify([[:space:]]|$)'; then
    reason="jarsigner (signing, not -verify)"; break
  fi
  # 4. Notarizing or stapling a Mac build.
  if printf '%s' "$segment" | grep -Eq 'notarytool[[:space:]]+submit|stapler[[:space:]]+staple'; then
    reason="notarization / stapling"; break
  fi
  # 5. electron-builder asked to publish.
  if printf '%s' "$segment" | grep -Eq 'electron-builder' &&
     printf '%s' "$segment" | grep -Eq -- '(--publish|-p)[[:space:]=]+(always|onTag|onTagOrDraft)'; then
    reason="electron-builder --publish"; break
  fi
  # 6. Installing a release APK on a device: an install verb and a *release*.apk in one segment.
  if printf '%s' "$segment" | grep -Eq '(^|[[:space:]])(install|install-multiple|install-multi-package)([[:space:]]|$)' &&
     printf '%s' "$segment" | grep -Eq 'release[^[:space:]]*\.apk'; then
    reason="installing a release APK"; break
  fi
done < <(printf '%s\n' "$executable" | tr ';&|' '\n\n\n')

if [ -n "$reason" ]; then
  jq -n --arg r "$reason" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: ("Refused: " + $r + ". Signing, notarizing, publishing and installing a release build are the owner'"'"'s acts and need the owner'"'"'s explicit approval at the time.\n\nIf the owner has approved it, they run it themselves with `! <command>`. Verifying (apksigner verify, jarsigner -verify, codesign -v, spctl -a) and an UNSIGNED assembleRelease are allowed; build release artifacts in a scratch copy so app/build/outputs/apk/release/ is left alone.\n\nWhy: on 2026-09-29 an incidental assembleRelease signed an APK with the publishing key. See app/build.gradle.kts and scripts/hooks/no-release-signing.sh.")
    }
  }'
fi
