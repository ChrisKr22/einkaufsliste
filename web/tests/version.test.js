// App-Version: VERSION im Projektordner ist die einzige Quelle; build.py überträgt sie in die Einstellungen.

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('VERSION hat die Form Major.Minor.Patch', () => {
  assert.match(read('../../VERSION').trim(), /^\d+\.\d+\.\d+$/);
});

test('Einstellungen zeigen die Version aus VERSION (nach build.py)', () => {
  const shown = read('../index.html').match(/<span data-app-version>([^<]*)<\/span>/)?.[1];
  assert.equal(shown, read('../../VERSION').trim());
});

// Das Changelog liegt privat (privat/, nicht im Repository) – geprüft wird nur, wo es vorhanden ist, also nicht in der Pipeline.
const CHANGELOG = new URL('../../privat/CHANGELOG.md', import.meta.url);

test('CHANGELOG hat einen Eintrag für die aktuelle Version', { skip: !existsSync(CHANGELOG) && 'privat/CHANGELOG.md fehlt (z. B. in der Pipeline)' }, () => {
  const version = read('../../VERSION').trim();
  assert.ok(readFileSync(CHANGELOG, 'utf8').includes(`## ${version}`), `## ${version} fehlt in privat/CHANGELOG.md`);
});
