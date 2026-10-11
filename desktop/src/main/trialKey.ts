/**
 * The beta trial's **public** key — base64 of the Ed25519 key's SPKI DER (`MCowBQYDK2VwAyEA…`, 60
 * characters). It verifies tokens; it cannot make one.
 *
 * Created by the owner on their own Mac on 2026-10-12 with the one-time command in
 * `docs/trial-licence-summary-2026-10-11.md` → *Making the key*; only this public half was handed
 * over. The private half never enters this repository — `scripts/check-no-private-keys.mjs` refuses
 * it on every commit. Replacing this value invalidates every token issued so far, so it changes only
 * if the private key is lost or leaks.
 */
export const TRIAL_PUBLIC_KEY: string | null = 'MCowBQYDK2VwAyEA5JYQoRvRKm4y1orhtMhrO5dC4mJL75s4f6Xhz/olFKc=';
