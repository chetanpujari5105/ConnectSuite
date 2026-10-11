import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SealingBox } from './identityStore';
import {
  enteredTokenDecision,
  enteredTokenMessage,
  evaluateTrial,
  nextMark,
  noticeDue,
  noticeText,
  trialKeyUsable,
  verifyTrialToken,
  type TrialPayload,
  type TrialVerdict,
} from '../shared/trial';

/**
 * The beta trial on this Mac (2026-10-12): the stored token, the sealed clock mark, the notices shown,
 * and the one verdict the link gate, the IPC and the screens all read.
 *
 * ### What is stored, and where
 *
 * `trial.json` in this app's own profile folder — `sidekick-desktop` packaged, `sidekick-desktop-dev`
 * in development (defect 207), so the two never share one:
 *
 *  - `token`: the token as entered. It is public — signed, not secret — and holds the tester label and
 *    the two dates.
 *  - `mark`: the latest time this Mac has been seen at, **sealed** with `safeStorage` (the login
 *    Keychain), so it is not a plain number to edit. Deleting the file removes it, and that is the
 *    stated limit of an offline check: it keeps honest people honest. A build that cannot open the
 *    seal starts a fresh mark rather than locking anyone out.
 *  - `notices`: which of the 7-day and 1-day notices this token has already shown.
 *
 * Nothing here opens a socket. The verdict is computed from the token, the clock and the mark.
 */

/** A packaged build always checks. Only a development build with the `skipTrial` switch named does not. */
export function trialEnforced(i: { packaged: boolean; skipSwitch: boolean }): boolean {
  return i.packaged || !i.skipSwitch;
}

const FILE = 'trial.json';
/** The mark is rewritten when it has moved this far, not on every check. */
const MARK_WRITE_STEP_MS = 10 * 60_000;

interface StoredTrial {
  v: 1;
  token: string | null;
  /** base64 of the sealed decimal mark, or null. */
  mark: string | null;
  /** The mark in the clear, only when this Mac has no sealing available. */
  markPlain: number | null;
  notices: { id: string; shown: number[] } | null;
}

export interface TrialCheck extends TrialVerdict {
  /** A gentle notice due now, with its sentence, or null. */
  notice: { days: 7 | 1; text: string } | null;
}

export class Trial {
  private stored: StoredTrial;
  private markValue: number | null;
  private lastWrittenMark: number | null;

  constructor(
    private readonly o: {
      dir: string;
      box: SealingBox;
      publicKey: string | null;
      enforced: boolean;
      now?: () => number;
      log?: (level: 'info' | 'warn', line: string) => void;
    },
  ) {
    this.stored = this.read();
    this.markValue = this.openMark();
    this.lastWrittenMark = this.markValue;
  }

  private now(): number {
    return (this.o.now ?? Date.now)();
  }

  private log(level: 'info' | 'warn', line: string): void {
    this.o.log?.(level, line);
  }

  private read(): StoredTrial {
    const empty: StoredTrial = { v: 1, token: null, mark: null, markPlain: null, notices: null };
    const path = join(this.o.dir, FILE);
    if (!existsSync(path)) return empty;
    try {
      const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<StoredTrial>;
      return {
        v: 1,
        token: typeof raw.token === 'string' ? raw.token : null,
        mark: typeof raw.mark === 'string' ? raw.mark : null,
        markPlain: typeof raw.markPlain === 'number' && Number.isFinite(raw.markPlain) ? raw.markPlain : null,
        notices: raw.notices && typeof raw.notices.id === 'string' && Array.isArray(raw.notices.shown)
          ? { id: raw.notices.id, shown: raw.notices.shown.filter((n) => n === 7 || n === 1) }
          : null,
      };
    } catch (error) {
      this.log('warn', `${FILE} could not be read (${String(error)}) — starting with no token; the file is left as it was until the next write`);
      return empty;
    }
  }

  private openMark(): number | null {
    if (this.stored.mark !== null) {
      try {
        const value = Number(this.o.box.open(Buffer.from(this.stored.mark, 'base64')));
        return Number.isFinite(value) ? value : null;
      } catch (error) {
        this.log('warn', `the trial's clock mark could not be opened by this build (${String(error)}) — starting a fresh one, which only loses the clock check's memory`);
        return null;
      }
    }
    return this.stored.markPlain;
  }

  private write(): void {
    const sealed = this.markValue !== null && this.o.box.available();
    const out: StoredTrial = {
      ...this.stored,
      mark: sealed ? this.o.box.seal(String(this.markValue)).toString('base64') : null,
      markPlain: sealed ? null : this.markValue,
    };
    const path = join(this.o.dir, FILE);
    writeFileSync(`${path}.tmp`, JSON.stringify(out, null, 2), { mode: 0o600 });
    renameSync(`${path}.tmp`, path);
    this.stored = out;
    this.lastWrittenMark = this.markValue;
  }

  /** The stored token, if it still verifies against this build's key. An edited file is no token. */
  private currentPayload(): TrialPayload | null {
    if (!this.stored.token) return null;
    const check = verifyTrialToken(this.stored.token, this.o.publicKey);
    return check.kind === 'ok' ? check.payload : null;
  }

  /**
   * The verdict now. Advances the clock mark (never backwards, never while the clock is refused) and
   * persists it when it has moved enough to matter.
   */
  check(): TrialCheck {
    const now = this.now();
    const token = this.currentPayload();
    const verdict = evaluateTrial({
      enforced: this.o.enforced,
      keyPresent: trialKeyUsable(this.o.publicKey),
      token,
      now,
      mark: this.markValue,
    });
    if (this.o.enforced && verdict.state !== 'clock-back' && verdict.state !== 'no-key') {
      this.markValue = nextMark(this.markValue, now);
      const moved = this.lastWrittenMark === null || this.markValue - this.lastWrittenMark >= MARK_WRITE_STEP_MS;
      if (moved && (token || this.stored.token)) this.write();
    }
    const shown = token && this.stored.notices?.id === token.id ? this.stored.notices.shown : [];
    const due = noticeDue(verdict, shown);
    return { ...verdict, notice: due && token ? { days: due, text: noticeText(due, token.notAfter) } : null };
  }

  /** A pasted or opened token. Refusals change nothing and say why, kindly. */
  enter(text: string): { ok: boolean; message: string } {
    const check = verifyTrialToken(text, this.o.publicKey);
    if (check.kind !== 'ok') {
      this.log('info', `beta token refused: ${check.kind}`);
      return { ok: false, message: enteredTokenMessage(check.kind) };
    }
    const decision = enteredTokenDecision({ current: this.currentPayload(), entered: check.payload, now: this.now() });
    if (!decision.accept) {
      this.log('info', `beta token ${check.payload.id} refused: outside its dates`);
      return { ok: false, message: decision.message };
    }
    this.stored = { ...this.stored, token: text.replace(/\s+/g, '') };
    if (decision.resetMark) this.markValue = null;
    this.markValue = nextMark(this.markValue, this.now());
    this.write();
    this.log('info', `beta token ${check.payload.id} accepted — until ${check.payload.notAfter}${decision.resetMark ? '; clock check started fresh' : ''}`);
    return { ok: true, message: decision.message };
  }

  /** Records that the 7-day or 1-day notice was shown for the token in use. */
  noticeShown(days: 7 | 1): void {
    const token = this.currentPayload();
    if (!token) return;
    const shown = this.stored.notices?.id === token.id ? this.stored.notices.shown : [];
    if (shown.includes(days)) return;
    this.stored = { ...this.stored, notices: { id: token.id, shown: [...shown, days] } };
    this.write();
  }
}
