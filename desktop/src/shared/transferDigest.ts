import { createHash, type Hash } from 'node:crypto';
import { createReadStream } from 'node:fs';

/**
 * A SHA-256 over a transfer's **whole file**, including the part that was never sent.
 *
 * This exists as its own object, in the electron-free layer, because it is the one piece of the
 * transfer path whose failure destroys a good file and reports corruption while doing it — and
 * because a test can only reach it if it is not welded to a socket.
 *
 * ### The failure it exists to prevent
 *
 * A resumed transfer opens the partial at `offset` and streams the remainder. If the digest starts
 * at that moment it covers only the bytes that arrived *this* time — say the last 50 MB of a 200 MB
 * file — and is then compared against a digest of the whole file. They cannot match. So every
 * resumed transfer fails, on a file that is perfectly correct; `fs.transfer.done` reports
 * `CHECKSUM_MISMATCH`, which is corruption where there is none; the deletion rule then throws away
 * the partial; and the retry starts from zero, resumes, and fails the same way. Resume does not
 * merely stop working — it becomes **worse than having no resume at all**, because each attempt
 * destroys the progress of the last.
 *
 * Nothing in the log says "the digest started in the wrong place". It says the file was corrupt,
 * confidently, every time.
 *
 * ### The rule, as an object rather than a comment
 *
 * The receiver digests **from byte 0**. On resume it reads its own partial back from the start,
 * feeding it through the hash without writing it, and only then appends the arriving bytes. v1's
 * `TransferManager.skipBuffer` did exactly this. Making it a class rather than a convention is the
 * point: [primeFrom] is a call that has to be made, and a resumed transfer that skips it fails a
 * test rather than a user's file.
 */
export class TransferDigest {
  private hash: Hash = createHash('sha256');
  private primedBytes = 0;
  private appendedBytes = 0;
  private primed = false;

  /**
   * Feeds an existing partial back through the hash, from byte 0 to [bytes].
   *
   * Reads in a stream rather than into a buffer: the partial can be gigabytes, and the whole reason
   * this file exists is that the transfer path must never need the file to fit in memory.
   *
   * Reads **exactly** [bytes] and no more. A partial longer than the offset the receiver agreed to
   * resume from would otherwise silently fold extra bytes into the digest — the same class of fault
   * one layer down, and the reason this takes an explicit length rather than reading to EOF.
   */
  async primeFrom(path: string, bytes: number): Promise<void> {
    if (this.appendedBytes > 0) {
      throw new Error('primeFrom must be called before any chunk is appended');
    }
    if (bytes <= 0) {
      this.primed = true;
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const stream = createReadStream(path, { start: 0, end: bytes - 1 });
      stream.on('data', (chunk: string | Buffer) => {
        const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
        this.hash.update(buffer);
        this.primedBytes += buffer.length;
      });
      stream.on('error', reject);
      stream.on('end', () => resolve());
    });
    if (this.primedBytes !== bytes) {
      throw new Error(
        `the partial held ${this.primedBytes} bytes where ${bytes} were expected, so a resumed ` +
          'digest would not cover the file',
      );
    }
    this.primed = true;
  }

  /**
   * Primes from bytes the caller has already read — for a block-pull resume, which reads its owned
   * partial once through the file handle it identity-checked, hashing the blocks and priming this in
   * the same pass. [finishPriming] must then confirm the count, exactly as [primeFrom] does.
   */
  primeChunk(chunk: Uint8Array): void {
    if (this.appendedBytes > 0) throw new Error('priming must happen before any chunk is appended');
    this.hash.update(chunk);
    this.primedBytes += chunk.length;
  }

  finishPriming(bytes: number): void {
    if (this.primedBytes !== bytes) {
      throw new Error(`the partial held ${this.primedBytes} bytes where ${bytes} were expected, so a resumed digest would not cover the file`);
    }
    this.primed = true;
  }

  /** Adds bytes that have just arrived. */
  update(chunk: Buffer): void {
    this.appendedBytes += chunk.length;
    this.hash.update(chunk);
  }

  /**
   * The digest, hex.
   *
   * Refuses when a resume never primed. A digest that silently covers only the tail is the exact
   * failure above, and returning one would hand a caller a confident wrong answer — so this throws
   * instead, which is the difference between a bug that deletes a file and a stack trace.
   */
  digest(offset: number): string {
    if (offset > 0 && !this.primed) {
      throw new Error(
        `resumed at offset ${offset} without priming the digest: the result would cover only the ` +
          `${this.appendedBytes} bytes that arrived this time, not the whole file`,
      );
    }
    return this.hash.digest('hex');
  }

  /** Bytes read back from the partial and bytes appended, for the log line. Both, always. */
  counts(): { primed: number; appended: number; total: number } {
    return {
      primed: this.primedBytes,
      appended: this.appendedBytes,
      total: this.primedBytes + this.appendedBytes,
    };
  }
}
