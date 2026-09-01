// The one pasteboard fact Electron cannot see. Used to answer whether polling is self-triggering.
import AppKit
print(NSPasteboard.general.changeCount)
