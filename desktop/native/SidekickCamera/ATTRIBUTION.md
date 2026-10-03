# Attribution and licence decisions — Sidekick Camera (Camera v2, W1)

**No third-party code is copied into this package.** Everything here was written against Apple's
CoreMediaIO, VideoToolbox, CoreMedia, CoreVideo and Security headers in the Command Line Tools SDK
(macOS 26 SDK, Swift 6.3.2). The repository has no LICENSE file, which is why the GPL row below is
a hard line rather than a preference.

| Source | Licence, as read | Revision read | Decision |
|---|---|---|---|
| [Halle/SinkCam](https://github.com/Halle/SinkCam) | **MIT** — `LICENSE`: "Copyright (c) 2026 Halle Winkler". **Discrepancy:** the source files still carry a 2022 header reading "Copyright © 2022. All rights reserved." The repository's `LICENSE` grants the MIT permissions over the repository's contents; the stale header is recorded here rather than resolved | `ce124cfc4c599e93830a18c2944b1be47bb15559` (2026-05-18, "Added a note about how to make the CMIO sink more secure") | **Design reference only; no code copied.** Patterns taken: a timer-driven `consumeSampleBuffer(from:)` followed by `notifyScheduledOutputChanged`, and the sink's queue-size properties. Its README's injection warning is why `ProducerAuthorizer` exists. Its own `authorizedToStartStream` returns `true` for every client, which is the behaviour this package refuses |
| [ldenoue/cameraextension](https://github.com/ldenoue/cameraextension) | MIT (GitHub API, 2026-10-03) | not pinned; last push 2022-07-04 | Not read for this phase. Proposal §13: read, don't copy |
| OBS Studio `mac-virtualcam` | **GPL-2.0** | not read | **Not read and not used.** GPL code would impose the GPL on Sidekick; incorporating it needs the owner's separate approval |
| Apple's Camera Extension template / sample | Apple sample-code licence | not available without Xcode | Not used. W4 may start from Xcode's template; if it does, its licence is read then |

Files read from SinkCam, with SHA-256 of the bytes fetched from
`raw.githubusercontent.com/Halle/SinkCam/ce124cf…` on 2026-10-03:

```
791cd5ea3ba7926285fd6fd5bdcf3897653adf748c25c5d8c26e9a34d40cd2ce  LICENSE
24415274c377b13f7c7f258d42960b11ce0fa327b5603ee8c41709f9c26c12cc  README.md
3d22b8e04b9aa0a9c67d63a5f93adc147ce154373caa4d6647c2d49aa3d3521e  Extension/ExtensionProvider.swift
56ab19ca35b6d068f2ba5713188d61b205a425b2f22954c90ec5897e789ea372  Extension/Shared.swift
f9b5d3df11e1bf2d422a6f5f76fe7f48aaac0d0de4d23b7d438d13553766fe6e  Extension/main.swift
3e8c3781ee3180fac152f9b8541d0e7bbf686c5e1d4193f8a4de7a754162821d  Extension/Info.plist
eca0d76276a0787700926704feed4315973bb9ec546d6bac7370ba162b050711  Extension/Extension.entitlements
0750f0f6e2fb46d584b335cb1140f7de9008855f9e5821c5dc795e9561c33e15  SinkCamEndToEnd/ContentView.swift
```

If a later phase copies any SinkCam code, it must carry the MIT notice above in this file and in
the copied file, and name the revision it was copied from.
