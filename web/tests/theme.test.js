import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { THEME_KEY, applyTheme, readTheme, saveTheme } from '../js/theme.js';

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
    data,
  };
}

function fakeDocument() {
  const metas = [
    { media: '(prefers-color-scheme: light)', content: '' },
    { media: '(prefers-color-scheme: dark)', content: '' },
  ];
  return { documentElement: { dataset: {} }, querySelectorAll: () => metas, metas };
}

describe('Darstellung', () => {
  test('ohne Wahl gilt „System“, Unbekanntes ebenso', () => {
    assert.equal(readTheme(memoryStorage()), 'system');
    assert.equal(readTheme(memoryStorage({ [THEME_KEY]: 'lila' })), 'system');
    assert.equal(readTheme({ getItem: () => { throw new Error('gesperrt'); } }), 'system');
  });

  test('Wahl wird gemerkt; „System“ löscht den Eintrag', () => {
    const storage = memoryStorage();
    saveTheme('dark', storage);
    assert.equal(readTheme(storage), 'dark');
    saveTheme('system', storage);
    assert.equal(storage.data.has(THEME_KEY), false);
  });

  test('setzt data-theme und die Farbe der Statusleiste', () => {
    const doc = fakeDocument();
    applyTheme('dark', doc);
    assert.equal(doc.documentElement.dataset.theme, 'dark');
    assert.deepEqual(doc.metas.map((m) => m.content), ['#0E0F0E', '#0E0F0E']);
    applyTheme('light', doc);
    assert.deepEqual(doc.metas.map((m) => m.content), ['#F7F7F5', '#F7F7F5']);
    applyTheme('system', doc);
    assert.equal('theme' in doc.documentElement.dataset, false);
    assert.deepEqual(doc.metas.map((m) => m.content), ['#F7F7F5', '#0E0F0E']);
  });
});
