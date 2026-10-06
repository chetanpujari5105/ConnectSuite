# DRAFT — Pairing v2: the phone proves it scanned the code (audit S1, defect 182)

> **Status: DRAFT PROPOSAL. Not implemented. Not in `docs/protocol.md`.** Nothing here is the contract
> until it is approved and moved there; where this draft and `docs/protocol.md` disagree today,
> `docs/protocol.md` describes what ships. Written 2026-10-06. **Stop for approval before any code.**

## 1. The defect, in one paragraph

The QR the Mac draws carries the Mac's fingerprint and a one-time 128-bit token `K`. The phone scans it,
trusts the Mac's fingerprint, and arms a pairing for it. **That authenticates the Mac to the phone.
Nothing authenticates the phone to the Mac.** While a pairing is armed and nothing is stored, the Mac
connects to its discovery candidates, accepts **any** TLS peer (`desktop/src/main/link.ts:375`), sends
it `K` in the clear inside TLS as `hello.pairToken`, and pins that peer's certificate on its first
`hello.ack` (`link.ts:595`) — the comment reads *"the phone already proved it trusts us by accepting the
TLS connection"*. An impostor is the TLS server, so it accepts anything. Anyone on the LAN who answers
first during the five-minute window (an mDNS record copied from the phone's own `pair=` hint is enough)
becomes "the phone" permanently, and then receives the Mac's clipboard automatically, every push, and
the text of every SMS the user sends.

## 2. Goals and non-goals

**Goals**

1. The Mac stores a phone's fingerprint **only** after that phone proves knowledge of `K` over the
   connection the fingerprint was read from.
2. `K` never crosses the wire. Nothing an impostor receives lets it compute a proof, now or later.
3. No silent fallback: a peer that cannot run v2 gets a refusal with a reason, never the old path.
4. Nothing sensitive flows before both proofs are verified: no session token is used, no side channel
   is opened, no clipboard, push, SMS or call request is sent.
5. An impostor's failed attempt does not burn `K` for the real phone.

**Non-goals**

- Protecting a QR that someone else photographs. A photographed code is a leaked `K`; the mitigations
  are the ones already shipped (5-minute TTL, single use, rotation) and the user's own screen.
- Changing the steady-state link. Once pinned, both sides already verify each other on every
  connection (control pin `link.ts`, side-channel pin defect 178, phone client-auth `LinkTls.kt:121`).
- A PAKE. `K` has 128 bits of entropy and arrives out of band; a PAKE protects low-entropy secrets and
  would add a primitive neither platform ships.

## 3. Primitives — all reviewed, none invented

| Primitive | Mac | Phone |
|---|---|---|
| HMAC-SHA256 (RFC 2104) | `crypto.createHmac('sha256', K)` | `javax.crypto.Mac("HmacSHA256")` |
| Constant-time compare | `crypto.timingSafeEqual` | `java.security.MessageDigest.isEqual` |
| Nonces, 32 bytes | `crypto.randomBytes` | `java.security.SecureRandom` |
| Certificate fingerprints | SHA-256 over DER, as today | SHA-256 over DER, as today |

**Channel binding is by fingerprint and nonce, not by TLS exporter.** Both proofs include *both*
certificate fingerprints as each side observed them on this connection, plus fresh nonces. An impostor
relaying the real phone's proof fails because the Mac recomputes it with the **impostor's** fingerprint
— the one it actually sees. A relay the other way is impossible: the phone requires the Mac's client
certificate, whose private key the impostor does not have. The TLS 1.3 exporter (RFC 8446 §7.5) would
add defense in depth; it is listed as an option (§9) because its availability through a **public**
Android API (`android.net.ssl.SSLSockets.exportKeyingMaterial`) must be confirmed on a device first, and
this design must not depend on a hidden Conscrypt call.

## 4. The exchange (one round trip, as today)

Notation: `‖` is concatenation of length-prefixed UTF-8 or raw bytes; `Fm` the Mac's fingerprint and
`Fp` the phone's, both uppercase colon-hex as in the QR; `Nm`, `Np` 32-byte nonces, hex.

```
Mac (armed with K)                                   Phone (armed for Fm with K)
  TLS 1.3, Mac presents its certificate ──────────▶  checks Fm is trusted (as today)
  reads Fp from the peer certificate                  reads Fm from the client certificate
  hello { …, pair: { v: 2, nonce: Nm,
          proof: HMAC(K, "sidekick/pair/v2/mac" ‖ Nm ‖ Fm ‖ Fp) } }   — no pairToken
                                                      verifies the Mac proof with its own Fp
                                                      (constant time); on failure: pair.rejected
                                                      { reason: TOKEN_MISMATCH }, close
                                                      on success: consumes the arm (single use)
  ◀──────────── hello.ack { …, pair: { v: 2, nonce: Np,
          proof: HMAC(K, "sidekick/pair/v2/phone" ‖ Nm ‖ Np ‖ Fm ‖ Fp) } }
  verifies the phone proof with the Fp it saw
  only then: store paired = Fp, accept the session token, emit ready
```

Distinct labels for the two directions stop a proof from being reflected back. The Mac's proof binds
`Fp` as the Mac saw it, so a proof made for an impostor's connection is useless at the real phone; the
phone's proof binds `Nm`, so it cannot be replayed into a later connection.

## 5. Every case the brief named

| Case | Behaviour |
|---|---|
| **An attacker answers first** | It receives `Nm` and a Mac proof bound to its own `Fp` — useless anywhere else. It cannot produce a phone proof. The Mac closes, logs `pairing: a device at <host> could not prove it scanned this code`, does **not** consume `K`, and continues to the next candidate. After the first such failure the pairing screen says so once: *"Something on this network answered as a phone and could not prove it scanned this code. Keep the code on screen; your phone will still connect."* |
| **Replay** | A Mac proof cannot be replayed to the phone without the Mac's private key (TLS client auth). A phone proof is bound to `Nm`, fresh per connection. Both arms are single use. |
| **Timeout** | `K` expires 5 minutes after it is drawn (`PAIR_TOKEN_TTL_MS`, unchanged). A proof that verifies against an expired arm is refused `TOKEN_EXPIRED` — the phone checks expiry before HMAC so a stale arm costs no work. The Mac's `hello.ack` wait keeps its 10 s bound. |
| **Cancellation** | Closing or rotating the QR discards `K` on the Mac at once; an in-flight connection that has not verified the phone proof is torn down without storing anything. On the phone, *Cancel* disarms; a later Mac proof gets `TOKEN_MISMATCH`. |
| **Concurrent attempts** | The Mac tries candidates one at a time (today's loop); a second connection while one is verifying waits. The phone accepts one verification per arm: the first valid Mac proof consumes it; a second concurrent proof for the same arm gets `TOKEN_MISMATCH`. A *different*, already trusted Mac connecting meanwhile is unaffected (today's rule in `acceptPairToken`). |
| **Certificate changes** | A Mac whose identity changed (reinstall, bundle id) is not in the phone's trust store and fails TLS before pairing — scan again, as today. A phone whose certificate changed fails the Mac's stored pin — *forget and re-pair*, as today, now through v2. |
| **Older clients** | **New Mac, old phone:** `hello.ack` arrives with no `pair.v ≥ 2` → the Mac stores nothing and says *"Update Sidekick on your phone to pair with this Mac."* **Old Mac, new phone:** a `hello` with a raw `pairToken` and no v2 proof → `pair.rejected { reason: UPGRADE_REQUIRED }` (new reason, §6), close. **Neither side ever pairs on the old path.** An old Mac shows its generic fallback sentence for the unknown reason, which is the documented behaviour for unknown reasons. |
| **The phone's mDNS `pair=` hint** | Unchanged and harmless: it says a scan happened. It no longer decides anything security-relevant, because an impostor advertising it still cannot prove `K`. |

## 6. Proposed contract changes (to be moved into `docs/protocol.md` only on approval)

- `hello.pair` (Mac → phone, only while armed): `{ "v": 2, "nonce": "<64 hex>", "proof": "<64 hex>" }`.
  `hello.pairToken` is **removed**; a phone that receives it refuses with `UPGRADE_REQUIRED`.
- `hello.ack.pair` (phone → Mac, only when the hello carried `pair`): same shape, the phone's proof.
- `pair.rejected.reason` gains `UPGRADE_REQUIRED`: *"This Mac's Sidekick is too old to pair securely.
  Update it, then show a fresh code."*
- `ext.pair = 2` is advertised by both sides so a log line can say which pairing version ran; the
  decision rests on the `pair` field, never on `ext`.
- A new `PAIR_PROOF_FAILED` local event on the Mac (not on the wire) feeds the pairing screen's line.

`scripts/check-protocol-spec.mjs` will require `hello.pair` and `UPGRADE_REQUIRED` to be specified as
the subject of a paragraph when this moves into the contract.

## 7. Existing pairings — migration, and when re-pairing is needed

- **Existing pairs keep working and are not forced to re-pair.** The hole is in the pairing window, not
  in the pinned steady state; v2 changes only what happens while a pairing is armed.
- **What cannot be known:** whether any existing pin was set by an impostor. Every current pairing was
  made on the v1 path (all of them after the 2026-09-17 bundle-id change). For the owner's own Mac and
  phone on a home network the risk is small; it is not zero, and the honest statement is that it is
  unknown.
- **Recommendation:** ship v2 with a *Pair again securely* button in Settings → Connection (it is
  *Forget this phone* plus a fresh code) and one sentence in the release notes: *pairings made before
  this version were not verified on the Mac's side; if you paired on a network you do not control, pair
  again.* A first public release needs every user to pair anyway.
- **Re-pairing is required** when: either side's certificate changes; the user forgets on either side;
  or the user chooses the button above.

## 8. Tests the implementation must carry (red first against today's code)

Mac, loopback TLS like `pinnedTls.test.ts`:
1. An impostor that completes TLS and answers `hello.ack` without a proof → **nothing stored**, the
   loop continues, and the impostor received **no** raw token (assert the bytes it read contain no
   `K`) — red today on both counts.
2. The real (simulated) phone with `K` → stored, ready; control for test 1.
3. A phone proof copied from another connection (different `Nm`) → refused.
4. A proof computed with the wrong `Fp` (relay) → refused.
5. Old phone (no `pair`) → refused with the update sentence; nothing stored.
6. Expired `K`, rotated `K`, cancelled screen mid-handshake → nothing stored.
7. An impostor first, then the real phone, in one armed window → paired with the real phone.

Phone, JVM (the HMAC and the verdict as pure functions, as `PairTokenVerdict` is today):
8. A valid Mac proof → accepted and the arm consumed; a second identical proof → `TOKEN_MISMATCH`.
9. A raw `pairToken` with no proof → `UPGRADE_REQUIRED`.
10. Constant-time comparison is used (source scan, as `NotificationKeyLogTest` scans the relay).

Hardware (supervised, separately approved): one real pairing on the SM-S938B; then one with a local
stand-in impostor on the same LAN answering first, showing the screen line and the real phone still
pairing.

## 9. Options considered

| Option | Why not chosen as the base |
|---|---|
| Phone sends HMAC(K, …) **after** the Mac sent raw `K` | Broken: an impostor that received `K` computes any proof. Recorded as the wrong fix in defect 182 |
| User compares a 6-digit code on both screens (SAS) | Adds a step to a flow whose promise is "scan once"; the QR already is an authenticated out-of-band channel |
| PAKE (SPAKE2, CPace) | For low-entropy secrets; no platform implementation on either side; new code where none is needed |
| TLS exporter binding (RFC 8446 §7.5) | Good defense in depth; **adopt if** `SSLSockets.exportKeyingMaterial` is confirmed public and working on the test phone, as an extra input to both HMACs |
| Put the phone's fingerprint in a second QR the Mac scans | The Mac has a camera only sometimes; a second scan breaks the one-scan promise |

## 10. Also in this batch: S2b (defect 189)

The phone's `acceptSideChannel` discards the fingerprint `LinkTls.handshake` returns, so a token is
accepted from any trusted Mac. Compare it with the session's peer and refuse otherwise. Small, phone
only, JVM-testable through the pure claim path.

## 11. What approval would authorise

Moving §6 into `docs/protocol.md`; implementing §4 on both sides behind no flag (there is no safe "off");
the tests in §8; S2b. Not authorised by approval of this draft: any install, re-pair or hardware run —
those are the plan-F steps, each approved separately.
