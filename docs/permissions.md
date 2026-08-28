# Sensitive permissions, and what they cost to distribute

Written 2026-08-27, when Phase 4 declared `SEND_SMS`, `CALL_PHONE` and `ANSWER_PHONE_CALLS`.

This file exists because the decision to declare them is cheap and the consequence is not, and
because "we will deal with Play later" is how a feature gets built and then deleted. Nothing here
changes what Phase 4 builds. It records what publishing it would cost, so that the choice is made
once, in the open, rather than discovered by a rejected app submission.

## What was declared, and why each one is load-bearing

`CapabilityContract` refuses to advertise a capability unless every message it requires has a
handler. So a permission that is missing does not degrade a feature — it removes it.

| Permission | Required by | Without it |
|---|---|---|
| `SEND_SMS` | `sms.send` | the whole `sms` capability is grey, forever |
| `CALL_PHONE` | `call.dial` | the whole `calls` capability is grey, forever |
| `ANSWER_PHONE_CALLS` | `call.answer`, `call.reject` | as above |
| `READ_SMS` | `sms.threads`, `sms.messages` | already declared |
| `READ_CALL_LOG`, `READ_PHONE_STATE` | `call.log`, call events | already declared |
| `READ_CONTACTS` | `contacts.list`, `contacts.get` | already declared, never requested until now |

`SEND_SMS` is the one that was actually costing something already: `Capabilities.kt` has required
it since v1 and it was declared in no manifest in the repo, so `sms` could never be advertised no
matter what the user did in Settings. That was recorded as Bug 3 in `docs/status.md` and is now
fixed.

## The Play position

`SEND_SMS`, `READ_SMS`, `RECEIVE_SMS` and `READ_CALL_LOG` are in Google Play's **restricted
permissions** set. An app that requests them must either be the user's selected default SMS or
Phone handler, or be granted an exception for a permitted use case, declared in Play Console with
a demo video. Requesting them without one is a policy rejection, not a warning.

The relevant permitted use case is the one this app is: a **device companion**, mirroring the
user's own messages and calls to a paired computer they own. It is the same category KDE Connect
and every phone-to-desktop bridge ships under. It is a real exception and it is granted, but it is
granted *per submission*, on review, and it is the single most likely reason a build of this app
is rejected.

`CALL_PHONE` and `ANSWER_PHONE_CALLS` are not restricted in the same way, though
`ANSWER_PHONE_CALLS` is a dangerous permission with no exception path — the user grants it or the
feature does not run.

### What this means in practice

- **For the way this app is actually used today** — built from source, installed by sideload, on
  the developer's own phone — none of this applies. There is no Play submission and no review.
- **For a Play release**, the SMS and calls features need the companion-app declaration, a demo
  video, and a privacy policy URL. Budget it as a real piece of work in Phase 7 (packaging and
  distribution), not as a checkbox.
- **The architecture already helps.** Nothing leaves the device except to a Mac the user paired by
  scanning a QR code, over TLS, with no server anywhere. That is exactly the argument the exception
  asks for, and it is true here rather than aspirational.

### The alternative we are not taking

Becoming the default SMS handler removes the restriction entirely, and is what some companion apps
do. It is rejected here because it means owning the user's entire messaging experience — the
notification, the compose UI, the storage — to enable one feature of a mirroring app. The cost to
the user is far larger than the feature.

## Related platform walls

These sit in `CLAUDE.md` under "Platform walls" and are repeated here because they are the ones
users ask about in the same breath as the permissions above:

- **Call audio cannot be streamed.** `CAPTURE_AUDIO_OUTPUT` is system-only and AccessibilityService
  call recording violates Play policy. The documented answer is to pair the Mac to the phone over
  Bluetooth as an audio device. Answering a call from the Mac therefore answers it *on the phone*.
- **MMS is not SMS.** Reading MMS parts needs `READ_SMS` plus content-resolver access to
  `content://mms`, and sending MMS is a different API path again. See `docs/protocol.md` for what
  `sms.*` does and does not promise.
