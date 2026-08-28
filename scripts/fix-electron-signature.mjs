/**
 * Re-signs the prebuilt Electron.app with an ad-hoc signature on macOS.
 *
 * The Electron binaries shipped by @electron/get are linker-signed only, with no
 * Developer ID and no sealed resources. Gatekeeper resolves their CDHash to a
 * revoked notarisation ticket and blocks launch — offering "Move to Trash" as the
 * default action, which silently removes the bundle from node_modules.
 *
 * Re-signing produces a fresh CDHash that Apple has no ticket for, so Gatekeeper
 * has nothing to revoke against. Runs after every install because npm re-extracts
 * the bundle from cache each time.
 *
 * No-op on every platform except darwin, and never fails the install.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);

function resolveAppBundle() {
  // Resolves via the package entry point so this works regardless of hoisting.
  const packageDir = path.dirname(require.resolve('electron'));
  const distDir = path.join(packageDir, 'dist');

  // path.txt holds the executable path relative to dist/, e.g.
  // "Electron.app/Contents/MacOS/Electron". The first segment is the bundle.
  const executablePath = readFileSync(path.join(packageDir, 'path.txt'), 'utf8').trim();
  const [bundleName] = executablePath.split(path.sep);

  if (!bundleName?.endsWith('.app')) {
    return null;
  }

  return path.join(distDir, bundleName);
}

function main() {
  if (process.platform !== 'darwin') {
    return;
  }

  let appBundle;
  try {
    appBundle = resolveAppBundle();
  } catch {
    // electron is a devDependency; absent under --omit=dev.
    return;
  }

  if (!appBundle || !existsSync(appBundle)) {
    return;
  }

  const result = spawnSync('codesign', ['--force', '--deep', '--sign', '-', appBundle], {
    encoding: 'utf8',
  });

  if (result.error || result.status !== 0) {
    const detail = result.error?.message ?? result.stderr?.trim() ?? `exit ${result.status}`;
    console.warn(
      `\nWarning: could not ad-hoc sign ${path.basename(appBundle)} — ${detail}\n` +
        'Gatekeeper may block "npm start". Re-run manually with:\n' +
        `  codesign --force --deep --sign - "${appBundle}"\n`
    );
    return;
  }

  console.log(`Ad-hoc signed ${path.basename(appBundle)} for local Gatekeeper approval.`);
}

main();
