// Freigabe-Code: von der App erzeugt, von tools/catalog/vorschlaege.py gelesen und angewendet (Austausch JS ↔ Python).

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { addSuggestions, emptyReview, releaseMessage } from '../js/data/review.js';

const toolDir = fileURLToPath(new URL('../../tools/catalog/', import.meta.url));
const hasPython = spawnSync('python3', ['--version']).status === 0;

const script = `
import json, sys
sys.path.insert(0, ${JSON.stringify(toolDir)})
import vorschlaege, katalog
text = sys.stdin.read()
accepted, rejected = vorschlaege.read_release(text)
catalog = {"version": 7, "categories": [{"id": "konserven", "name": "Konserven"}, {"id": "snacks", "name": "Snacks"}, {"id": "sonst", "name": "Sonstiges"}],
           "products": [{"id": "mais", "name": "Mais", "category": "konserven", "synonyms": []},
                        {"id": "chips", "name": "Chips", "category": "snacks", "synonyms": ["Kartoffelchips"]}]}
catalog, rejected_list, added, skipped = vorschlaege.apply_release(accepted, rejected, catalog, [{"name": "Kaugummi", "datum": "2026-10-01"}], "2026-10-18")
errors, _ = katalog.check(catalog)
print(json.dumps({"catalog": catalog, "rejected": rejected_list, "skipped": skipped, "errors": errors, "dump": katalog.dump(catalog)}, ensure_ascii=False))
`;

test('Freigabe aus der App wird am Mac richtig übernommen', { skip: !hasPython && 'python3 fehlt' }, async () => {
  const { review } = addSuggestions(emptyReview(), [
    { n: 'Ajvar', k: 'konserven', u: 'g', y: ['Paprikamus'] },
    { n: 'Kartoffelchips', k: 'snacks' },          // gibt es schon als Suchwort
    { n: 'Kaugummi', k: 'snacks' },
    { n: 'Lakritz', k: 'snacks' },
  ], new Set(['konserven', 'snacks', 'sonst']));
  const decide = { Ajvar: 'accept', Kartoffelchips: 'accept', Kaugummi: 'reject', Lakritz: 'reject' };
  for (const item of review.items) item.decision = decide[item.name];
  const text = await releaseMessage(review);

  const run = spawnSync('python3', ['-I', '-c', script], { input: text, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const out = JSON.parse(run.stdout);
  assert.deepEqual(out.errors, []);
  assert.equal(out.catalog.version, 8);
  assert.deepEqual(out.catalog.products.map((p) => p.id), ['mais', 'ajvar', 'chips'], 'neues Produkt steht bei seiner Kategorie');
  assert.deepEqual(out.catalog.products[1], { id: 'ajvar', name: 'Ajvar', category: 'konserven', synonyms: ['Paprikamus'], unit: 'g', origin: 'vorschlag' });
  assert.ok(out.skipped.some((s) => s.startsWith('Kartoffelchips: schon im Katalog')));
  assert.deepEqual(out.rejected.map((r) => r.name), ['Kaugummi', 'Lakritz'], 'schon abgelehnte nicht doppelt');
  assert.deepEqual(JSON.parse(out.dump), out.catalog, 'Hausformat ist gültiges JSON');
});

test('kaputte oder fremde Freigabe wird abgewiesen', { skip: !hasPython && 'python3 fehlt' }, () => {
  for (const input of ['ohne Code', 'FY-FREIGABE:jeyJ2IjoyfQ']) {   // zweiter: {"v":2}
    const run = spawnSync('python3', ['-I', '-c', `import sys; sys.path.insert(0, ${JSON.stringify(toolDir)})\nimport vorschlaege\ntry:\n    vorschlaege.read_release(sys.stdin.read())\nexcept ValueError as e:\n    print("abgewiesen:", e)`], { input, encoding: 'utf8' });
    assert.match(run.stdout, /^abgewiesen:/, run.stderr);
  }
});
