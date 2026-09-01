// Writes a pasteboard entry the way a password manager does: real text **plus** a marker type.
//
// This exists because Electron cannot build one. `clipboard.write({ [type]: … })` silently drops a
// custom type and `writeBuffer` replaces the whole pasteboard, so the Electron-only run could prove
// the marker is *readable* and could never produce the state that matters — text and marker
// together. That left the actual 1Password case unmeasured and the concealed check unproven on the
// only input it exists for.
//
// NSPasteboard has no such limitation, and this is the same API a password manager calls.
//
// Usage: swift write-marked-clip.swift <text> [marker-uti ...]
import AppKit

let args = Array(CommandLine.arguments.dropFirst())
guard let text = args.first else {
    FileHandle.standardError.write("usage: write-marked-clip.swift <text> [uti ...]\n".data(using: .utf8)!)
    exit(2)
}
let markers = args.dropFirst().map { NSPasteboard.PasteboardType($0) }

let pb = NSPasteboard.general
pb.clearContents()
pb.declareTypes([.string] + markers, owner: nil)
pb.setString(text, forType: .string)
// The convention carries the marker as a present type; its value is not read. Empty data is what
// the documented implementations write, so that is what is written here.
for marker in markers {
    pb.setData(Data(), forType: marker)
}
print("wrote \(text.utf8.count) bytes of text plus \(markers.count) marker type(s); changeCount=\(pb.changeCount)")
for type in pb.types ?? [] {
    print("  type on the pasteboard: \(type.rawValue)")
}
