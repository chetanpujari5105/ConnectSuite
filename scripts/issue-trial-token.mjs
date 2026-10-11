#!/usr/bin/env node
/**
 * Issues one Sidekick beta token — run by the owner, on the owner's Mac, with the owner's private key.
 *
 *   node scripts/issue-trial-token.mjs --key ~/.sidekick-trial-key/private.pem --label "Asha" --days 45
 *   node scripts/issue-trial-token.mjs --key … --label "Asha" --days 45 --start 2026-10-20 --out asha.sidekick-token
 *
 * Prints the token on stdout (or writes it to `--out`), and a summary on stderr: id, label, start, end.
 * Appends the same summary to `issued-tokens.tsv` beside the key, as the owner's private ledger.
 *
 * - `--days` counts whole days from the start of `--start` (default: today, in UTC), so a token issued
 *   in the evening still starts that day. The end is an absolute instant inside the signed token —
 *   reinstalling Sidekick, a new profile or a second Mac all see the same end.
 * - The private key is read, used once and dropped. **It is never printed, copied or written** by this
 *   script. Create it once with the command in `docs/trial-licence-summary-2026-10-11.md` →
 *   *Making the key*, keep it outside the repository (mode 600), and back it up offline.
 *
 * The format and the verification are `desktop/src/shared/trial.ts` — the same file the Mac app checks
 * with — so a token this prints is, by construction, one the app reads. Nothing here touches a network.
 */
import { createPrivateKey, randomBytes, sign } from 'node:crypto';
import { appendFileSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DAY_MS, assembleToken, encodePayload, signingInput } from '../desktop/src/shared/trial.ts';

/** Builds and signs one token. Pure apart from the randomness of `id`; the key is a PEM string. */
export function issueToken({ privateKeyPem, label, days, start = null, id = randomBytes(12).toString('base64url') }) {
  const key = createPrivateKey(privateKeyPem);
  if (key.asymmetricKeyType !== 'ed25519') throw new Error(`the key is ${key.asymmetricKeyType}, not an Ed25519 private key`);
  const name = String(label ?? '').trim();
  if (name.length === 0 || name.length > 80) throw new Error('--label must be 1–80 characters');
  if (!Number.isInteger(days) || days < 1 || days > 400) throw new Error('--days must be a whole number from 1 to 400');
  const from = start === null ? startOfUtcDay(Date.now()) : parseDay(start);
  const payload = {
    v: 1,
    id,
    label: name,
    notBefore: new Date(from).toISOString(),
    notAfter: new Date(from + days * DAY_MS).toISOString(),
  };
  const body = encodePayload(payload);
  return { token: assembleToken(body, sign(null, Buffer.from(signingInput(body), 'ascii'), key)), payload };
}

function startOfUtcDay(ms) {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function parseDay(text) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error('--start must be YYYY-MM-DD');
  const ms = Date.parse(`${text}T00:00:00.000Z`);
  if (!Number.isFinite(ms)) throw new Error(`--start ${text} is not a date`);
  return ms;
}

/** `--name value` pairs. Unknown flags are refused rather than ignored. */
export function parseArgs(argv) {
  const known = new Set(['--key', '--label', '--days', '--start', '--out']);
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--help' || flag === '-h') return { help: true };
    if (!known.has(flag)) throw new Error(`unknown argument ${flag}`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`${flag} needs a value`);
    out[flag.slice(2)] = value;
    i += 1;
  }
  for (const needed of ['key', 'label', 'days']) if (!out[needed]) throw new Error(`--${needed} is required`);
  return { help: false, key: out.key, label: out.label, days: Number(out.days), start: out.start ?? null, out: out.out ?? null };
}

const USAGE = 'usage: node scripts/issue-trial-token.mjs --key <private.pem> --label "<tester>" --days <n> [--start YYYY-MM-DD] [--out <file>]';

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`${error.message}\n${USAGE}`);
    process.exit(2);
  }
  if (args.help) {
    console.log(USAGE);
    return;
  }
  const keyPath = args.key.replace(/^~(?=\/)/, process.env.HOME ?? '~');
  const mode = statSync(keyPath).mode & 0o777;
  if (mode & 0o077) console.error(`warning: ${keyPath} is readable by others (mode ${mode.toString(8)}); chmod 600 it`);
  const { token, payload } = issueToken({
    privateKeyPem: readFileSync(keyPath, 'utf8'),
    label: args.label,
    days: args.days,
    start: args.start,
  });
  if (args.out) writeFileSync(args.out, `${token}\n`);
  else console.log(token);
  const row = [new Date().toISOString(), payload.id, payload.label, payload.notBefore, payload.notAfter].join('\t');
  appendFileSync(join(dirname(keyPath), 'issued-tokens.tsv'), `${row}\n`);
  console.error(`issued ${payload.id} for ${payload.label}: ${payload.notBefore} → ${payload.notAfter}${args.out ? ` (written to ${args.out})` : ''}; ledger: ${join(dirname(keyPath), 'issued-tokens.tsv')}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
