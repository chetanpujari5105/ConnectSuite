/**
 * What a person typed into "the phone's address", as a host and a port.
 *
 * ### The defect this exists for (2026-11-10, a tester's video)
 *
 * The phone shows its address as `10.35.99.249:42501` (`PhoneAddress.controlEndpoint`). The Mac's
 * field stored whatever was typed, and discovery handed the stored string to `tls.connect` as the
 * **host** with the control port beside it. `10.35.99.249:42501` is not a host: Node asks the
 * resolver for it and gets `ENOTFOUND` in ~150 ms. So copying the address exactly as the phone
 * displays it could never connect, on any network, and the screen said only *"Trying …"*.
 *
 * The rule has one home and both doors use it: the IPC handler that stores the address, and
 * discovery when it reads one back — the second so that a value stored by an older build heals
 * without the person retyping it.
 */

export type ParsedPhoneAddress =
  | { ok: true; host: string; port: number | null }
  | { ok: false; reason: 'empty' | 'bad-port' | 'bad-host' };

/**
 * Accepts `192.168.1.42`, `192.168.1.42:42501`, a hostname with or without a port, `[v6]:port`, a
 * bare IPv6 address, and any of those with a pasted `scheme://` or trailing path. `port` is null when
 * none was typed, so the caller's default applies.
 */
export function parsePhoneAddress(input: string | null | undefined): ParsedPhoneAddress {
  let text = (input ?? '').trim();
  if (text === '') return { ok: false, reason: 'empty' };

  text = text.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/[/?#].*$/, '');

  let host = text;
  let portText: string | null = null;

  const bracketed = /^\[([^\]]+)\](?::(.*))?$/.exec(text);
  if (bracketed) {
    host = bracketed[1]!;
    portText = bracketed[2] ?? null;
  } else if ((text.match(/:/g) ?? []).length === 1) {
    // Exactly one colon is host:port. More than one is a bare IPv6 address and is left whole.
    const at = text.indexOf(':');
    host = text.slice(0, at);
    portText = text.slice(at + 1);
  }

  let port: number | null = null;
  if (portText !== null) {
    if (!/^\d{1,5}$/.test(portText)) return { ok: false, reason: 'bad-port' };
    port = Number(portText);
    if (port < 1 || port > 65535) return { ok: false, reason: 'bad-port' };
  }

  if (host === '' || /\s/.test(host) || !/^[0-9a-z.:_%-]+$/i.test(host)) {
    return { ok: false, reason: 'bad-host' };
  }
  return { ok: true, host, port };
}

/** The form that is stored and shown: the host alone, or `host:port` when a port was typed. */
export function formatPhoneAddress(parsed: { host: string; port: number | null }): string {
  if (parsed.port === null) return parsed.host;
  return parsed.host.includes(':') ? `[${parsed.host}]:${parsed.port}` : `${parsed.host}:${parsed.port}`;
}
