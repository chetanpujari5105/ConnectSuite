// F5's stimulus: a stranger on the LAN presenting a client certificate the phone has not pinned.
//
// Why a client cert at all, and why this probe is not `openssl s_client`: LinkServer only records
// `lastRefusal` when it can read a certificate off the refused session (`prefix != null`). A client
// that presents NO certificate is refused, logged, and never reaches the screen — so a probe
// without a cert would produce a clean, confident FALSE NEGATIVE on the exact feature under test.
//
// What this does NOT prove: it is not the Electron app. It is the other case the copy names — "a
// stranger on the network" rather than "your Mac, reinstalled". The phone-side path is identical
// (it reads whatever cert the peer presented); the fidelity gap is which cert arrives.
//
// Reports the EFFECT — what the phone did — never the stimulus it sent.
import tls from 'node:tls';
import fs from 'node:fs';

const [host, port, certPath, keyPath] = process.argv.slice(2);
const TIMEOUT_MS = 8000;                       // an instrument bound, so it is reported
const t0 = Date.now();
const out = { host, port: +port, timeoutMs: TIMEOUT_MS };

const sock = tls.connect({
  host, port: +port,
  cert: fs.readFileSync(certPath),
  key: fs.readFileSync(keyPath),
  rejectUnauthorized: false,                   // we are testing THEIR trust of US, not ours of them
  minVersion: 'TLSv1.2',
}, () => {
  // NOT a result. In TLS 1.3 the client's handshake completes BEFORE the server has validated the
  // client certificate, so this callback fires on a connection the phone is about to reject. An
  // earlier version of this probe called finish() here and reported ACCEPTED on a stranger the
  // phone refused 4 ms later — the instrument reporting its own optimism as the far end's verdict.
  // Worse, hanging up here means the server never reads our Certificate message: it logs
  // "no usable certificate", `prefix` is null, and `lastRefusal` is never set. The probe would
  // have destroyed the very state it exists to produce.
  out.clientHandshakeOk = true;                // labelled as OURS, not as the phone's answer
  sock.write('{"type":"probe"}\n');           // force the server to speak; its alert is the reading
});

sock.on('error', (e) => {
  out.result = 'REFUSED_BY_PHONE';
  out.code = e.code;
  out.message = e.message.split('\n')[0];
  finish();
});
sock.on('data', () => { out.result = 'ACCEPTED'; finish(); });   // the phone trusted a stranger
sock.on('close', () => { if (!out.result) { out.result = 'REFUSED_BY_PHONE'; out.how = 'server closed after our certificate'; finish(); } });
sock.setTimeout(TIMEOUT_MS, () => {
  out.result = 'NO_READING';                   // never 'refused' — the window may not have opened
  out.note = 'probe timed out; this is a missing reading, not a negative one';
  finish();
});

let done = false;
function finish() {
  if (done) return; done = true;
  out.elapsedMs = Date.now() - t0;
  console.log(JSON.stringify(out, null, 2));
  try { sock.destroy(); } catch {}
  process.exit(0);
}
