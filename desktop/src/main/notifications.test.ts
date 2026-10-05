import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NotificationClient } from './notifications';
import { log } from './logger';
import type { LinkClient } from './link';

/**
 * A reply or an action the phone refuses as the wrong conversation is refused with a sentence that
 * quotes the conversation's title — *"…the notification from "Ada Lovelace" has been replaced…"* —
 * which is usually a person's name. The person reads it; the rotating log gets the code.
 */

const SENTENCE = 'That was not sent: the notification from "Ada Lovelace" has been replaced by one from someone else.';

function refusingLink(): LinkClient {
  return {
    isConnected: () => true,
    request: () =>
      Promise.reject(Object.assign(new Error(`WRONG_CONVERSATION: ${SENTENCE}`), { code: 'WRONG_CONVERSATION', phoneMessage: SENTENCE })),
  } as unknown as LinkClient;
}

function capture(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const saved = { info: log.info, warn: log.warn, error: log.error };
  log.info = (w: string, m: string) => { lines.push(`${w}|${m}`); };
  log.warn = (w: string, m: string) => { lines.push(`${w}|${m}`); };
  log.error = (w: string, m: string) => { lines.push(`${w}|${m}`); };
  return { lines, restore: () => Object.assign(log, saved) };
}

const KEY = '0|com.whatsapp|1|null|10123';

for (const [what, run] of [
  ['reply', (c: NotificationClient) => c.reply(KEY, 'on my way')],
  ['action', (c: NotificationClient) => c.action(KEY, 0)],
] as const) {
  test(`a refused ${what} reaches the person whole and the log without the title`, async () => {
    const client = new NotificationClient(() => refusingLink());
    client.onPosted({ key: KEY, package: 'com.whatsapp', appName: 'WhatsApp', title: 'Ada Lovelace', text: 'hi', whenMs: 1, canReply: true, actions: [{ index: 0, title: 'Mark as read' }] });
    const cap = capture();
    try {
      const result = await run(client);
      assert.equal(result.ok ? '' : result.reason, SENTENCE, 'control: the person reads the sentence');
      assert.ok(cap.lines.some((l) => l.includes('WRONG_CONVERSATION')), `control: logged by code — ${cap.lines.join(' / ')}`);
      assert.deepEqual(cap.lines.filter((l) => l.includes('Ada')), [], 'the title reached the log');
    } finally {
      cap.restore();
    }
  });
}
