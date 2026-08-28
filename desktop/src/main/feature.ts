import type { LinkClient } from './link';
import { type Envelope, type PhoneAck, type PhoneFailure, type PhoneRequestError, type PhoneResult } from '../shared/protocol';
import { log } from './logger';

/**
 * The shared half of every Phase 4 feature client: ask the phone, and never throw at the renderer.
 *
 * Each feature owns its own file and its own vocabulary. What they share is this: a request goes
 * out, and what comes back is either data or a sentence — never an exception across the IPC
 * bridge, because `ipcRenderer.invoke` would wrap it in Electron plumbing (defect 22).
 *
 * Deliberately *not* modelled on `InputClient`. That class serialises requests into a queue and
 * throws away anything that has waited too long, because input is a live conversation with a phone
 * in someone's hand and a tap that has sat for half a second is not one they still want delivered.
 * None of that applies here: fetching a page of messages is a query, two queries in flight are
 * fine, and a list that arrives late is still the list. Copying the queue would add latency and a
 * failure mode for no benefit.
 */

/** How long any Phase 4 request may take before it is reported as a failure. */
const TIMEOUT_MS = 10_000;

/**
 * One request, with the phone's own sentence on failure.
 *
 * `extract` turns the ack payload into whatever the caller wants. It runs inside the try, so a
 * malformed payload becomes a named failure rather than an unhandled rejection somewhere in the
 * IPC layer — a phone sending a shape we did not expect is a real possibility across a version
 * skew, and it must read as "the phone sent something this Mac did not understand" rather than as
 * a crash.
 */
export async function ask<T>(
  link: LinkClient | null,
  feature: string,
  type: string,
  payload: Record<string, unknown>,
  extract: (payload: Record<string, unknown>) => T,
): Promise<PhoneResult<T>> {
  if (!link?.isConnected()) {
    return notConnected(feature, type);
  }
  try {
    const envelope: Envelope = await link.request(type, payload, TIMEOUT_MS);
    const data = extract(envelope.payload ?? {});
    log.info(feature, `${type} ok`);
    return { ok: true, data };
  } catch (error) {
    return failureOf(feature, type, error);
  }
}

/** One request whose only interesting outcome is that it worked. */
export async function tell(
  link: LinkClient | null,
  feature: string,
  type: string,
  payload: Record<string, unknown>,
): Promise<PhoneAck> {
  if (!link?.isConnected()) {
    return notConnected(feature, type);
  }
  try {
    await link.request(type, payload, TIMEOUT_MS);
    log.info(feature, `${type} ok`);
    return { ok: true };
  } catch (error) {
    return failureOf(feature, type, error);
  }
}

function notConnected(feature: string, type: string): PhoneFailure {
  log.warn(feature, `${type} refused here: not connected`);
  return {
    ok: false,
    reason: 'The Mac is not connected to the phone, so that was not sent.',
  };
}

/**
 * The phone's refusal, unwrapped.
 *
 * `phoneMessage` is the sentence the phone composed and is what a person reads. `message` keeps
 * its `CODE: sentence` form and is what the log wants. Keeping the hint as its own field rather
 * than joining it onto the sentence is what stops `…typing yet.On the phone: Settings > …` from
 * happening again — the renderer draws it as a second line.
 */
function failureOf(feature: string, type: string, error: unknown): PhoneFailure {
  const failure = error as PhoneRequestError;
  const reason = failure?.phoneMessage ?? failure?.message ?? String(error);
  log.warn(feature, `${type} refused: ${failure?.message ?? reason}`);
  return {
    ok: false,
    reason,
    ...(failure?.fixHint ? { fixHint: failure.fixHint } : {}),
    ...(failure?.code ? { code: failure.code } : {}),
  };
}

/** Reads an array of objects out of an ack payload, tolerating a phone that sent nothing. */
export function rows(payload: Record<string, unknown>, key: string): Array<Record<string, unknown>> {
  const value = payload[key];
  return Array.isArray(value) ? (value as Array<Record<string, unknown>>) : [];
}
