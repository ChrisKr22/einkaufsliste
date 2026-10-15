import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createBackup, parseBackup, restoreBackup } from '../js/data/backup.js';
import { ListModel } from '../js/list-model.js';
import { fitRect, removeLightBackground } from '../js/photo.js';
import { MemoryStore } from '../js/storage/memory-store.js';
import { photoUrl, setPhotoSources, thumb } from '../js/views/dom.js';
import { makeStore, productNamed } from './helpers.js';

const PHOTO = 'data:image/png;base64,iVBORw0KGgo=';

/** Bild w×h mit Hintergrundfarbe und einem farbigen Kreis in der Mitte. */
function picture(w, h, background, { radius = 20, color = [200, 30, 40] } = {}) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const inside = (x - w / 2) ** 2 + (y - h / 2) ** 2 < radius ** 2;
      const [r, g, b] = inside ? color : background;
      data.set([r, g, b, 255], i);
    }
  }
  return { data, width: w, height: h };
}

async function makeModel() {
  const { repository, store } = await makeStore();
  const model = new ListModel(repository, { toastMs: 50 });
  await model.load();
  return { model, repository, store };
}

describe('Fotos aufbereiten', () => {
  test('heller Hintergrund wird entfernt, Rahmen umschließt das Motiv', () => {
    const img = picture(100, 80, [248, 247, 245]);
    const box = removeLightBackground(img);
    assert.ok(box);
    assert.ok(Math.abs(box.x - 30) <= 2 && Math.abs(box.y - 20) <= 2, `Rahmen ${JSON.stringify(box)}`);
    assert.ok(Math.abs(box.width - 40) <= 3 && Math.abs(box.height - 40) <= 3);
    assert.equal(img.data[3], 0, 'Ecke transparent');
    assert.equal(img.data[(40 * 100 + 50) * 4 + 3], 255, 'Mitte deckend');
  });

  test('dunkler oder bunter Hintergrund bleibt stehen', () => {
    assert.equal(removeLightBackground(picture(60, 60, [40, 90, 50])), null);
    const img = picture(60, 60, [250, 250, 250], { radius: 200 });   // Motiv füllt alles
    assert.equal(removeLightBackground(img), null);
  });

  test('Einpassen: mit Rand bzw. randlos', () => {
    const fit = fitRect(200, 100, 480, { margin: 0.1 });
    assert.deepEqual(fit, { x: 48, y: 144, width: 384, height: 192 });
    const fill = fitRect(200, 100, 480, { fill: true });
    assert.deepEqual(fill, { x: -240, y: 0, width: 960, height: 480 });
  });
});

describe('Eigene Fotos speichern', () => {
  test('setzen, ersetzen, Rückgängig, Standardbild', async () => {
    const { model, repository } = await makeModel();
    const apples = await productNamed(repository, 'Äpfel');
    await model.setPhoto(apples, PHOTO);
    assert.equal(model.state.photos.get(apples.id), PHOTO);
    assert.equal(model.hasOwnPhoto(apples), true);
    assert.equal(model.state.toast.text, 'Foto für Äpfel gespeichert');

    await model.setPhoto(apples, `${PHOTO}2`);
    await model.undo();
    assert.equal(model.state.photos.get(apples.id), PHOTO, 'Rückgängig holt das vorherige Foto');

    await model.removePhoto(apples);
    assert.equal(model.hasOwnPhoto(apples), false);
    await model.undo();
    assert.equal(model.state.photos.get(apples.id), PHOTO, 'Rückgängig nach „Standardbild“');
  });

  test('Rückgängig beim ersten Foto entfernt es wieder', async () => {
    const { model, repository } = await makeModel();
    const milk = await productNamed(repository, 'Milch');
    await model.setPhoto(milk, PHOTO);
    await model.undo();
    assert.equal(model.hasOwnPhoto(milk), false);
  });

  test('Fotos sind in der Sicherung, ältere Sicherungen ohne Fotos gehen weiter', async () => {
    const { model, repository, store } = await makeModel();
    const bread = await productNamed(repository, 'Brot');
    await model.setPhoto(bread, PHOTO);
    const backup = await createBackup(store);
    assert.deepEqual(backup.data.photos.map((p) => p.productId), [bread.id]);

    const other = new MemoryStore();
    await restoreBackup(other, parseBackup(JSON.stringify(backup)));
    assert.equal((await other.get('photos', bread.id)).dataUrl, PHOTO);

    const old = JSON.parse(JSON.stringify(backup));
    delete old.data.photos;
    assert.equal(parseBackup(JSON.stringify(old)).data.photos.length, 0);

    const broken = JSON.parse(JSON.stringify(backup));
    broken.data.photos[0].dataUrl = 'javascript:alert(1)';
    assert.throws(() => parseBackup(JSON.stringify(broken)), /beschädigt \(Foto\)/);
  });
});

describe('Bildquelle', () => {
  const product = { id: 'p1', catalogId: 'aepfel', name: 'Äpfel' };

  test('eigenes Foto vor Katalogfoto vor Symbol', () => {
    setPhotoSources({ own: new Map(), bundled: new Set() });
    assert.equal(photoUrl(product), null);
    assert.match(thumb(product, 'obst'), /<svg/);

    setPhotoSources({ bundled: new Set(['aepfel']) });
    assert.equal(photoUrl(product), 'images/aepfel.png');
    assert.match(thumb(product, 'obst'), /<img src="images\/aepfel.png"/);

    setPhotoSources({ own: new Map([['p1', PHOTO]]) });
    assert.equal(photoUrl(product), PHOTO);
    assert.match(thumb(product, 'obst', 'large'), /class="thumb large has-photo"/);
    setPhotoSources({ own: new Map(), bundled: new Set() });
  });

  test('eigene Produkte ohne Katalog-ID nutzen nur eigene Fotos', () => {
    setPhotoSources({ own: new Map(), bundled: new Set(['x']) });
    assert.equal(photoUrl({ id: 'c1', catalogId: null }), null);
  });
});
