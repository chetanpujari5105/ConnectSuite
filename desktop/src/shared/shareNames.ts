/**
 * The name a shared file is saved under on the Mac — docs/phase-7-share-proposal.md §5, *Mac-side
 * name*. The Mac **re-sanitises and never trusts the phone's name**. The phone's `ShareNames.kt`
 * applies the same rules, and both are tested against one fixture, `docs/fixtures/share-names.json`,
 * so the two cannot drift apart unnoticed (plan G7).
 *
 * Rules, in order: NFC; drop control (Cc) and format (Cf) characters — the latter holds bidi
 * overrides such as U+202E, which can make `txt.exe` read as `exe.txt`; `/` and `:` become `-`;
 * trim; a leading `.` becomes `_`; cap at 255 UTF-8 bytes keeping a short extension; empty becomes
 * `Shared file`.
 */

export const EMPTY_NAME = 'Shared file';
const MAX_NAME_BYTES = 255;

function utf8Bytes(s: string): number {
  return Buffer.byteLength(s, 'utf8');
}

export function sanitizeShareName(name: string): string {
  const cleaned = name
    .normalize('NFC')
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .replace(/[/:]/g, '-')
    .trim();
  if (cleaned === '') return EMPTY_NAME;
  const dotted = cleaned.startsWith('.') ? `_${cleaned.slice(1)}` : cleaned;
  return capBytes(dotted);
}

function capBytes(name: string): string {
  if (utf8Bytes(name) <= MAX_NAME_BYTES) return name;
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 && name.length - dot <= 16 ? name.slice(dot) : '';
  const budget = MAX_NAME_BYTES - utf8Bytes(ext);
  const stem = name.slice(0, name.length - ext.length);
  let kept = '';
  let used = 0;
  for (const ch of stem) {
    // `for … of` walks code points, so a surrogate pair is never split.
    const size = utf8Bytes(ch);
    if (used + size > budget) break;
    kept += ch;
    used += size;
  }
  return kept + ext;
}

/** `name`, `name (2).ext`, `name (3).ext` … — the nth candidate for a free final name. */
export function candidateName(name: string, n: number): string {
  if (n <= 1) return name;
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  return `${stem} (${n})${ext}`;
}
