import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Resolve the global config/memory directory, Claude Code style:
 *   Windows : %APPDATA%\lazyquery
 *   macOS   : ~/Library/Application Support/lazyquery
 *   Linux   : $XDG_CONFIG_HOME/lazyquery or ~/.config/lazyquery
 * Override with LAZYQUERY_CONFIG.
 */
export function configDir(): string {
  if (process.env.LAZYQUERY_CONFIG) return process.env.LAZYQUERY_CONFIG;

  const platform = process.platform;
  if (platform === 'win32') {
    const appData = process.env.APPDATA;
    if (appData) return join(appData, 'lazyquery');
  } else if (platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'lazyquery');
  }
  const xdg = process.env.XDG_CONFIG_HOME;
  if (xdg) return join(xdg, 'lazyquery');
  return join(homedir(), '.config', 'lazyquery');
}
