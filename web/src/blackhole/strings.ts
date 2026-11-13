/**
 * UI strings for the black hole module. The bh.* keys live in the app dictionaries
 * (web/src/i18n/{uz,en,ru}.json) like every other string; `tr` is kept as the module's name for
 * the app's `t`, so the language follows the switcher and the saved choice.
 */

import { t } from '../i18n';

export function tr(key: string, vars?: Record<string, string | number>): string {
  return t(key, vars);
}
