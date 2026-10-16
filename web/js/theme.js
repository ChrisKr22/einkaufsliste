// Darstellung: System (folgt dem iPhone), Hell oder Dunkel. Gilt nur auf diesem Gerät.
// Die Farben selbst stehen in css/app.css (:root[data-theme="light" | "dark"]).

export const THEME_KEY = 'fy-theme';
export const THEMES = ['system', 'light', 'dark'];
export const THEME_LABELS = { system: 'System', light: 'Hell', dark: 'Dunkel' };

// Farbe der Statusleiste/Browserleiste je Modus (wie --bg in app.css).
const BAR_COLORS = { light: '#F7F7F5', dark: '#0E0F0E' };

export function readTheme(storage = globalThis.localStorage) {
  try {
    const value = storage?.getItem(THEME_KEY);
    return THEMES.includes(value) ? value : 'system';
  } catch {
    return 'system';
  }
}

export function saveTheme(theme, storage = globalThis.localStorage) {
  try {
    if (theme === 'system') storage?.removeItem(THEME_KEY);
    else storage?.setItem(THEME_KEY, theme);
  } catch { /* Wahl gilt dann nur bis zum Schließen */ }
}

/** Setzt data-theme am <html> und passt die Farbe der Statusleiste an. */
export function applyTheme(theme, doc = globalThis.document) {
  const root = doc.documentElement;
  if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
  else delete root.dataset.theme;
  for (const meta of doc.querySelectorAll('meta[name="theme-color"]')) {
    const scheme = meta.media?.includes('dark') ? 'dark' : 'light';
    meta.content = BAR_COLORS[theme === 'system' ? scheme : theme];
  }
}

/** Auswahl „System · Hell · Dunkel“ in den Einstellungen. */
export function mountThemeSection(root, { storage = globalThis.localStorage } = {}) {
  const buttons = [...root.querySelectorAll('[data-theme-choice]')];
  const show = (theme) => {
    for (const b of buttons) b.setAttribute('aria-checked', String(b.dataset.themeChoice === theme));
  };
  for (const b of buttons) {
    b.addEventListener('click', () => {
      const theme = b.dataset.themeChoice;
      saveTheme(theme, storage);
      applyTheme(theme, root.ownerDocument);
      show(theme);
    });
  }
  const current = readTheme(storage);
  applyTheme(current, root.ownerDocument);
  show(current);
}
