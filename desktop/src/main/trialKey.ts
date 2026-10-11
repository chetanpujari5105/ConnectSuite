/**
 * The beta trial's **public** key — base64 of the Ed25519 key's SPKI DER (`MCowBQYDK2VwAyEA…`, 60
 * characters). It verifies tokens; it cannot make one.
 *
 * `null` until the owner creates the keypair on their own Mac (the one-time command is in
 * `docs/trial-licence-summary-2026-10-11.md` → *Making the key*) and hands over the public half. The
 * private half never enters this repository — `scripts/check-no-private-keys.mjs` refuses it on every
 * commit. While this is `null`, a build checks nothing successfully: every token is refused and the
 * Mac says the build cannot check tokens, which is the honest state of a build without a key.
 */
export const TRIAL_PUBLIC_KEY: string | null = null;
