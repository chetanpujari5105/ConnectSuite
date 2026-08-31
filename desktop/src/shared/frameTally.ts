/**
 * Frames and bytes a channel has accepted, carried so that a refusal can be read against them.
 *
 * Twin of core/.../link/FrameTally.kt, down to the wording of the refusal, so the same over-size
 * frame reads the same in `link.log` and in the phone's log when the two are put side by side.
 *
 * It exists because of the counter rule: a refusal count with no denominator is not evidence.
 * "Closed the bulk socket, 1 frame rejected" is the same line whether it was the first frame of a
 * broken channel or the ten-thousandth frame of a transfer that had already moved 2 GB, and those
 * want opposite responses. The refusal message is built here, where the successes are, so it
 * cannot be written without them.
 */
export class FrameTally {
  accepted = 0;
  bytesAccepted = 0;
  rejected = 0;

  constructor(private readonly channel: string) {}

  accept(bytes: number): void {
    this.accepted += 1;
    this.bytesAccepted += bytes;
  }

  /**
   * Counts a refusal and returns the line describing it — which cap, what length, and the accepted
   * totals it has to be read against.
   */
  reject(kind: string, length: number, cap: number): string {
    this.rejected += 1;
    const why = length < 0 ? `is negative (cap ${cap} bytes)` : `exceeds the ${cap}-byte cap`;
    return `${kind} frame length ${length} ${why} on the ${this.channel} channel — closing the socket; ${this.summary()}`;
  }

  summary(): string {
    return `${this.accepted} frames / ${this.bytesAccepted} bytes accepted, ${this.rejected} rejected`;
  }
}
