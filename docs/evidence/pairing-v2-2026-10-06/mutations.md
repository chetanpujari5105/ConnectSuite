# Pairing v2 and S2b — red-first and mutation evidence (2026-10-06)

All runs local, loopback only, synthetic certificates. No phone, no running Sidekick.

## The original defect, on the original code

`s1-red-first-against-head.demo.ts` runs **HEAD's unmodified** `LinkClient` (an isolated `git archive`
copy, never committed as a test) against an impostor TLS server on `127.0.0.1:42501`, reached as the
`lastAddress` candidate so no gateway lookup or mDNS traffic happened. Output (`s1-red-first-against-head.txt`):

```
HEAD RESULT: connected=true pinned=IMPOSTOR tokenSentToImpostor=true
```

The impostor became the paired phone and received the v1 pairing token in the clear inside TLS.

## Mutations — each restores one removed safeguard; files restored by SHA-256 afterwards

Mac (`src/main/link.ts`, run against `pairingV2Link.test.ts`, 15 tests):

| Mutation | Red | Which |
|---|---|---|
| M1 accept a `hello.ack` with no verified proof | 3 | attacker-first; downgrade (skipProof); inject |
| M2 send the secret in `hello` | 3 | valid pairing (secret on the wire); attacker-first; old phone (pairToken present) |
| M3 skip the phone-proof check | 5 | forged; relayed; replayed; wrong secret; failure limit |
| M4 no pre-authentication message drop | 1 | inject |
| M5 store without `attempt.verified` | **0** | **equivalent mutant**: the gate at the top of `onHelloAck` already refuses every unverified `hello.ack`, so the second condition is unreachable. Kept as defence in depth, stated rather than counted |

Phone (`core/.../link`, run against `PairingV2Test`, 17 tests):

| Mutation | Red | Which |
|---|---|---|
| K1 accept `pair.confirm` without verifying | 2 | wrong proof/secret/certificate + limit; replay |
| K2 persist trust after `hello.ack` instead of before | 1 | source order check |
| K3 S2b owner check removed (HEAD's behaviour) | 1 | only the session's own Mac may claim its side channel |
| K4 tolerate a v1 token | 1 | no fallback |
| K5 `==` instead of `MessageDigest.isEqual` | 1 | source check — constant time is not measurable in a unit test, so this is a code-shape guard, not a timing proof |

## Stability

`pairingV2Link.test.ts` + `pairingV2.test.ts`: 6 of 6 consecutive runs 18/18; 3 of 3 runs 15/15 under
eight `yes` processes of CPU load.
