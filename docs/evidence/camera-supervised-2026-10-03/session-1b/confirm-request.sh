#!/bin/bash
# Waits for the driver's own verdict on the request press, then reads the Mac log from the size before start.
S=/private/tmp/claude-501/-Users-chetan-Desktop-ConnectSuite/b6667378-7e73-419a-a7da-c65c35bdcb39/scratchpad/s1b
ML="$HOME/Library/Application Support/sidekick-desktop/logs/sidekick.log"
until grep -q -E "REQUEST pressed once|ABORT|driver exit" $S/driver.out 2>/dev/null; do sleep 0.3; done
grep -E "REQUEST pressed once|ABORT|driver exit" $S/driver.out | cut -c1-300
sleep 1
tail -c +$(( $(cat $S/maclog-start-size.txt) + 1 )) "$ML" | grep -E "camera\.request" | cut -c1-200
grep -E "stream id, from the Mac" $S/driver.out | cut -c1-220
