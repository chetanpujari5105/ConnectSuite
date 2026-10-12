#!/bin/bash
# Recording fake adb for the case-D local tests. Camera clients and the phone log come from files the
# harness writes from the fake page's state. Never touches a device.
echo "$*" >> "${FAKE_ADB_LOG:-/dev/null}"
case "$*" in
  devices*) printf 'List of devices attached\nRZCY12330DT\tdevice usb:1 product:x model:SM_S938B device:x\n' ;;
  *"getprop ro.product.model"*) echo SM-S938B ;;
  *"getprop ro.build.version.sdk"*) echo 36 ;;
  *"media.camera"*) echo "Active Camera Clients: $(cat "$FAKE_CAM_FILE") " ;;
  *"tail -n"*) [[ "$*" =~ tail\ -n\ ([0-9]+) ]] && tail -n "${BASH_REMATCH[1]}" "$FAKE_PHONE_LOG" ;;
  *) : ;;
esac
