#!/bin/bash
# Records every call; answers the reads the pin and the actor make. Never touches a device.
echo "$*" >> "${FAKE_ADB_LOG:-/dev/null}"
case "$*" in
  devices*) printf 'List of devices attached\nRZCY12330DT\tdevice usb:1 product:x model:SM_S938B device:x\n' ;;
  *"getprop ro.product.model"*) echo SM-S938B ;;
  *"getprop ro.build.version.sdk"*) echo 36 ;;
  *"media.camera"*) echo "Active Camera Clients: [] " ;;
  *) : ;;
esac
