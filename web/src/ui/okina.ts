/**
 * Uzbek oʻ / gʻ use U+02BB (and ʼ U+02BC). IBM Plex Sans draws U+02BB as a 0.6 em wide spacing
 * letter, so "yoʻli" reads "yo ʻ li" (measured in Chrome: 9 px at 15 px vs 4 px for ’). Spectral's
 * glyph is apostrophe-width, so the sans stack takes just these two code points from the bundled
 * Spectral file (unicode-range), leaving the text itself in U+02BB for search, copy and screen readers.
 */
import okinaUrl from '@fontsource/spectral/files/spectral-latin-400-normal.woff2?url';

try {
  const face = new FontFace('Atlas Okina', `url(${okinaUrl}) format('woff2')`, { unicodeRange: 'U+02BB-02BC', weight: '100 900', display: 'swap' });
  document.fonts.add(face);
  void face.load();
} catch {
  /* FontFace unavailable: Plex's wide glyph is still correct text */
}
