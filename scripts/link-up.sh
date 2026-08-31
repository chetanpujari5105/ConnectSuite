#!/bin/bash
#
# Is LinkService up? Three readings, all of which must pass. Exit 0 only if they all do.
#
# It exists because the obvious check is wrong. `Listening on 42501/42502/42503` is written by
# LinkServer.start(), called from LinkService.onCreate() and nowhere else — so on a service that is
# already running the line is absent BY DESIGN, and a grep for it after a launch reports a healthy
# service as dead. That is defect 29's shape: a query that cannot tell its target from something
# resembling it, answering with full confidence. It cost a sitting on 2026-08-30.
#
# The uid match in readings 2 and 3 is the control, not decoration: a LISTEN on 42501 with no uid
# check cannot separate our server from whatever else took the port — which is exactly the case
# LinkServer logs "Could not bind listeners ... address already in use" for.
#
# Usage: scripts/link-up.sh [package]        (default com.chetan.connectsuite.debug)
set -uo pipefail
pkg="${1:-com.chetan.connectsuite.debug}"
fail=0
say() { printf '%-8s %s\n' "$1" "$2"; [ "$1" = FAIL ] && fail=1; return 0; }

uid=$(adb shell run-as "$pkg" id -u 2>/dev/null | tr -d '\r')
[ -n "$uid" ] || { echo "FAIL     cannot read $pkg's uid (device offline, or not debuggable)"; exit 2; }
echo "uid      $pkg = $uid   ← the control for readings 2 and 3"

# 1. The service exists, is foreground, and has a createTime you can date.
svc=$(adb shell dumpsys activity services "$pkg" 2>/dev/null | grep -A 30 "core.link.LinkService c:")
created=$(printf '%s' "$svc" | grep -oE 'createTime=[^ ]+' | head -1)
if printf '%s' "$svc" | grep -q 'isForeground=true'; then
  say OK "1. ServiceRecord present, isForeground=true, ${created:-createTime=?}"
else
  say FAIL "1. no foreground ServiceRecord for core.link.LinkService"
fi

# 2. All three ports bound, under that uid. /proc/net/tcp6: $2 local, $4 state (0A=LISTEN), $8 uid.
listen=$(adb shell cat /proc/net/tcp6 2>/dev/null | awk -v u="$uid" '$4=="0A" && $8==u && $2 ~ /:(A605|A606|A607)$/')
n=$(printf '%s' "$listen" | grep -c .)
[ "$n" -eq 3 ] && say OK "2. 42501/42502/42503 all LISTEN under uid $uid" \
               || say FAIL "2. $n of 3 ports LISTEN under uid $uid (a port held by another uid is not ours)"

# 3. Somebody is actually attached to the control port. 01 = ESTABLISHED.
estab=$(adb shell cat /proc/net/tcp6 2>/dev/null | awk -v u="$uid" '$4=="01" && $8==u && $2 ~ /:A605$/')
m=$(printf '%s' "$estab" | grep -c .)
[ "$m" -ge 1 ] && say OK "3. $m control session(s) ESTABLISHED on 42501 under uid $uid" \
               || say FAIL "3. no control session on 42501 — the server is up but no Mac is attached"

exit "$fail"
