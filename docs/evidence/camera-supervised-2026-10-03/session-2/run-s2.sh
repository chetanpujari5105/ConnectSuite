#!/bin/bash
# Session 2, case D: the driver's own gates are the final foreground/awake/idle check, and its request
# follows them in the same process. The actor starts at the same moment and binds to that request's id.
S=/private/tmp/claude-501/-Users-chetan-Desktop-ConnectSuite/b6667378-7e73-419a-a7da-c65c35bdcb39/scratchpad
D=$S/s2
cd /Users/chetan/Desktop/ConnectSuite
stat -f %z "$HOME/Library/Application Support/sidekick-desktop/logs/sidekick.log" > $D/maclog-start-size.txt
date '+%Y-%m-%dT%H:%M:%S' > $D/started.txt
node $S/actor.mjs disconnect $D/actor-report.json 28482 > $D/actor.out 2>&1 &
node scripts/camera-driver.mjs --execute --case plain --report $D/driver-report.json --owner-present > $D/driver.out 2>&1
echo "driver exit $?" >> $D/driver.out
wait
echo "both finished" >> $D/driver.out
