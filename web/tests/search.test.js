import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { searchProducts } from '../js/search.js';
import { makeProduct } from './helpers.js';

const products = [
  makeProduct('Olivenöl', ['Öl']),
  makeProduct('Rapsöl', ['Sonnenblumenöl', 'Öl']),
  makeProduct('Spaghetti', ['Nudeln', 'Pasta']),
  makeProduct('Penne', ['Nudeln', 'Pasta']),
  makeProduct('Tomaten', ['Tomate']),
  makeProduct('Gehackte Tomaten', ['Dosentomaten']),
  makeProduct('Karotten', ['Möhren']),
  makeProduct('Brötchen', ['Semmeln']),
];
const names = (q) => searchProducts(q, products).map((p) => p.name);

describe('Produktsuche', () => {
  test('leere Suche findet nichts', () => {
    assert.deepEqual(names(''), []);
    assert.deepEqual(names('   '), []);
  });

  test('Namensanfang kommt zuerst', () => assert.equal(names('tom')[0], 'Tomaten'));

  test('Wort im Namen wird gefunden', () => assert.ok(names('tomaten').includes('Gehackte Tomaten')));

  test('Synonyme werden gefunden', () => {
    assert.deepEqual(new Set(names('nud')), new Set(['Spaghetti', 'Penne']));
    assert.deepEqual(names('möhre'), ['Karotten']);
  });

  for (const q of ['öl', 'Öl', 'ol', 'oel']) {
    test(`Umlaute: „${q}“ findet Olivenöl`, () => assert.ok(names(q).includes('Olivenöl')));
  }

  test('Umlaute im Namen ausgeschrieben oder weggelassen', () => {
    assert.deepEqual(names('broetchen'), ['Brötchen']);
    assert.deepEqual(names('brotchen'), ['Brötchen']);
  });

  test('kleine Tippfehler', () => {
    assert.ok(names('Tomtaen').includes('Tomaten'));
    assert.ok(names('Spagetti').includes('Spaghetti'));
  });

  test('kurze Eingaben ohne Tippfehler-Toleranz', () => assert.deepEqual(names('xyz'), []));

  test('häufig Gekauftes gewinnt bei Gleichstand', () => {
    const list = [makeProduct('Penne', ['Nudeln']), makeProduct('Fusilli', ['Nudeln'], 5)];
    assert.equal(searchProducts('nudeln', list)[0].name, 'Fusilli');
  });

  test('Limit wird eingehalten', () => assert.equal(searchProducts('e', products, 2).length, 2));
});
