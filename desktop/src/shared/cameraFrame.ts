/**
 * The camera stream's reader — docs/protocol.md → The camera frame.
 *
 * Main-process only: `index.html` does not load this file, so it is an ordinary module with exports
 * (`check-renderer-scripts.mjs` scopes itself from `index.html` for exactly that reason). Electron-free,
 * so `cameraFrame.test.ts` runs it against the cross-language golden vector the phone's encoder is
 * held to, `docs/fixtures/camera-frame-v1.hex`.
 *
 * ### Strict, and it closes rather than resyncs
 *
 * Every rule in the contract's "the Mac closes the stream on any malformed frame" list is a throw
 * here. A camera stream that has lost sync is not worth recovering mid-flight: the honest outcome is
 * an error on the pane and a stopped stream, and a resync heuristic is exactly how a garbled frame
 * ends up drawn as though it were the phone's camera.
 */

import { CAMERA_MAX_FRAME } from './protocol';

export const FRAME_HEADER_BYTES = 13;
export const CAMERA_HEADER_BYTES = 16;
export const CAMERA_VERSION = 1;
export const CAMERA_FORMAT_JPEG = 1;
export const CAMERA_MAX_EDGE = 4096;

export type CameraFacing = 'back' | 'front' | 'external';

const FACINGS: CameraFacing[] = ['back', 'front', 'external'];

/** One decoded camera frame: its description, and the JPEG it describes. */
export interface CameraFrame {
  ptsUs: number;
  facing: CameraFacing;
  /** Quarter turns clockwise that make the picture upright, 0..3. */
  rotation: number;
  /** Mirror the upright picture left-to-right. */
  mirrored: boolean;
  epoch: number;
  width: number;
  height: number;
  sequence: number;
  jpeg: Buffer;
}

/** A frame that breaks the contract. The stream is closed; `reason` is for the log and the pane. */
export class CameraFrameError extends Error {
  constructor(readonly reason: string) {
    super(`malformed camera frame: ${reason}`);
  }
}

/**
 * Reads frames out of a byte stream that arrives in arbitrary chunks.
 *
 * `push` returns every whole frame the chunk completes and throws `CameraFrameError` on the first
 * malformed one; after a throw the reader is spent and must not be fed again. The sequence rule —
 * strictly increasing within a stream — is held here because it is the one rule that needs memory.
 */
export class CameraFrameReader {
  private buffer: Buffer = Buffer.alloc(0);
  private lastSequence = -1;
  private broken = false;

  push(chunk: Buffer): CameraFrame[] {
    if (this.broken) throw new CameraFrameError('reader already closed by an earlier malformed frame');
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
    const frames: CameraFrame[] = [];
    try {
      for (;;) {
        if (this.buffer.length < FRAME_HEADER_BYTES) break;
        const length = this.buffer.readUInt32BE(9);
        // Checked before waiting for the body, so a lying length cannot make this side buffer it.
        if (length > CAMERA_MAX_FRAME) throw new CameraFrameError(`length ${length} is over the ${CAMERA_MAX_FRAME}-byte cap`);
        if (this.buffer.length < FRAME_HEADER_BYTES + length) break;
        const frame = parseFrame(this.buffer.subarray(0, FRAME_HEADER_BYTES + length));
        if (frame.sequence <= this.lastSequence) {
          throw new CameraFrameError(`sequence ${frame.sequence} does not increase on ${this.lastSequence}`);
        }
        this.lastSequence = frame.sequence;
        frames.push(frame);
        this.buffer = this.buffer.subarray(FRAME_HEADER_BYTES + length);
      }
    } catch (error) {
      this.broken = true;
      this.buffer = Buffer.alloc(0);
      throw error;
    }
    return frames;
  }
}

/** One whole frame, header included. Throws `CameraFrameError` for anything the contract forbids. */
export function parseFrame(bytes: Buffer): CameraFrame {
  if (bytes.length < FRAME_HEADER_BYTES) throw new CameraFrameError('shorter than the frame header');
  const flags = bytes.readUInt8(0);
  const ptsUs = Number(bytes.readBigUInt64BE(1));
  const length = bytes.readUInt32BE(9);
  if (length > CAMERA_MAX_FRAME) throw new CameraFrameError(`length ${length} is over the cap`);
  if (bytes.length !== FRAME_HEADER_BYTES + length) throw new CameraFrameError('length does not match the bytes');
  if ((flags & 0x01) === 0) throw new CameraFrameError('keyframe bit clear — every camera frame stands alone');
  if (length < CAMERA_HEADER_BYTES + 2) throw new CameraFrameError(`payload of ${length} bytes is too short`);

  const h = FRAME_HEADER_BYTES;
  const version = bytes.readUInt8(h);
  const format = bytes.readUInt8(h + 1);
  const facingByte = bytes.readUInt8(h + 2);
  const rotation = bytes.readUInt8(h + 3);
  const cameraFlags = bytes.readUInt8(h + 4);
  const epoch = bytes.readUInt8(h + 5);
  const width = bytes.readUInt16BE(h + 6);
  const height = bytes.readUInt16BE(h + 8);
  const sequence = bytes.readUInt32BE(h + 10);
  const reserved = bytes.readUInt16BE(h + 14);

  if (version !== CAMERA_VERSION) throw new CameraFrameError(`version ${version} is not ${CAMERA_VERSION}`);
  if (format !== CAMERA_FORMAT_JPEG) throw new CameraFrameError(`format ${format} is not JPEG`);
  if (facingByte > 2) throw new CameraFrameError(`facing ${facingByte} is not 0..2`);
  if (rotation > 3) throw new CameraFrameError(`rotation ${rotation} is not 0..3`);
  if ((cameraFlags & ~0x01) !== 0) throw new CameraFrameError(`reserved flag bits set (${cameraFlags})`);
  if (reserved !== 0) throw new CameraFrameError('reserved bytes are not zero');
  if (width === 0 || width > CAMERA_MAX_EDGE || height === 0 || height > CAMERA_MAX_EDGE) {
    throw new CameraFrameError(`size ${width}x${height} is outside 1..${CAMERA_MAX_EDGE}`);
  }
  const jpeg = bytes.subarray(h + CAMERA_HEADER_BYTES);
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new CameraFrameError('payload is not a JPEG');

  return {
    ptsUs,
    facing: FACINGS[facingByte]!,
    rotation,
    mirrored: (cameraFlags & 0x01) !== 0,
    epoch,
    width,
    height,
    sequence,
    // A copy: the subarray aliases the reader's accumulator, which is about to move on.
    jpeg: Buffer.from(jpeg),
  };
}

/** The claim a camera socket opens with — docs/protocol.md → The stream claim on 42502. */
export function cameraClaim(token: string, streamId: string): string {
  return `${token} camera ${streamId}`;
}
