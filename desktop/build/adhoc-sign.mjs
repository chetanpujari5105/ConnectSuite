// electron-builder `afterPack` hook: ad-hoc sign the packaged .app, inside out.
//
// ## Why this exists rather than `identity:` in electron-builder.yml
//
// D12. The shipped 2026-09-02 .dmg was NOT unsigned, which is what `identity: null` was believed to
// produce. It was **never bundle-signed at all**: no `Contents/_CodeSignature`, and all eight nested
// components still carrying upstream ids (`Electron Framework`, `Electron Helper (GPU)`, …) whose
// resource seals no longer matched the renamed bundle. Gatekeeper's answer was therefore an ERROR —
// "code has no resources but signature indicates they must be present" — rather than a verdict,
// which is strictly worse than a rejection: an unassessable app gets "damaged, move to Trash" and
// has no user-facing override, while a *rejected* one can be opened from
// System Settings → Privacy & Security → Open Anyway.
//
// `identity: "-"` does not work here: electron-builder 25.1.8 treats "-" as a keychain identity
// name, finds nothing, and logs "skipped macOS application code signing". Measured, not assumed.
//
// ## What this buys and what it does not
//
// It converts an unassessable bundle into a validly-signed, untrusted one. That is the whole change:
// error → rejected. It does NOT notarize, does NOT remove the warning dialog, and does NOT make the
// app safe to hand to a stranger. Only a Developer ID certificate (Apple Developer Program, paid)
// plus notarization does that. This is the "hand it to someone I know" tier and is labelled as such.
//
// Order is inside-out because a bundle's seal covers its nested code: signing the parent first and
// a child afterwards invalidates the parent. Leaves, then frameworks, then helper apps, then the app.
import { execFileSync } from 'node:child_process';
import { readdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { applyFuses, RELEASE_FUSES } from './fuses.mjs';

const IDENTITY = '-';                       // ad-hoc. Not a placeholder for a real identity.

export default async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const appName = `${context.packager.appInfo.productFilename}.app`;
  const appPath = path.join(context.appOutDir, appName);
  const ents = path.join(context.packager.projectDir, 'build', 'entitlements.mac.plist');
  const appId = context.packager.appInfo.id;
  const fw = path.join(appPath, 'Contents', 'Frameworks');

  const sign = (target, identifier) => {
    const args = ['--force', '--sign', IDENTITY, '--options', 'runtime', '--entitlements', ents];
    if (identifier) args.push('--identifier', identifier);
    execFileSync('codesign', [...args, target], { stdio: 'pipe' });
  };

  const targets = [];
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory() && !e.isSymbolicLink()) {
        if (p.endsWith('.framework') || p.endsWith('.app')) { walk(p); targets.push(p); }
        else walk(p);
      } else if (e.isFile() && (p.endsWith('.dylib') || p.endsWith('.so'))) {
        targets.push(p);                    // leaves first: they are pushed before their container
      } else if (e.isFile() && !path.extname(p) && (statSync(p).mode & 0o111)) {
        targets.push(p);                    // helper executables, e.g. chrome_crashpad_handler
      }
    }
  };
  walk(fw);

  // S5 (defect 184): the fuses live in the framework binary, so they are written BEFORE anything is signed —
  // a byte changed after signing would break the seal. `applyFuses` refuses a wire it does not recognise.
  const frameworkBinary = path.join(fw, 'Electron Framework.framework', 'Versions', 'A', 'Electron Framework');
  const fuses = applyFuses(frameworkBinary, RELEASE_FUSES);
  console.log(`  • fuses       ${fuses.before} → ${fuses.after} (RunAsNode, NODE_OPTIONS, --inspect off; ASAR integrity and ASAR-only on)`);

  let ok = 0;
  const failed = [];
  for (const t of targets) {
    try { sign(t); ok++; } catch (e) { failed.push(`${path.basename(t)}: ${e.message.split('\n')[0]}`); }
  }
  sign(appPath, appId);                      // the app last, and it carries OUR id, not Electron's

  // The check has to GATE, or it is decoration. A build that cannot verify must not produce a .dmg:
  // shipping an unverifiable bundle is exactly the defect this hook exists to fix.
  try {
    execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'pipe' });
  } catch (e) {
    throw new Error(
      `adhoc-sign: ${appName} does not verify after signing — refusing to build an artifact that ` +
      `Gatekeeper cannot assess. codesign said: ${e.stderr?.toString().trim() || e.message}`,
    );
  }
  // Successes beside failures: "3 failed" alone reads as whichever story the reader already believes.
  console.log(
    `  • adhoc-sign  ${ok}/${targets.length} nested components + the app bundle, ` +
    `id=${appId}, verified deep${failed.length ? ` — ${failed.length} FAILED: ${failed.join('; ')}` : ''}`,
  );
}
