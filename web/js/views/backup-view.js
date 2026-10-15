// Einstellungen › Sicherung: Daten als Datei exportieren (Teilen-Menü bzw. Download) und wieder einspielen.

import { esc } from './dom.js';

const REMIND_AFTER_DAYS = 30;
const formatDate = (value) => new Date(value).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });

export function mountBackupSection(root, model) {
  const status = root.querySelector('#backup-status');
  const fileInput = root.querySelector('#backup-file');
  const confirmBox = root.querySelector('#backup-confirm');
  const errorBox = root.querySelector('#backup-error');
  let pendingText = null;

  function showError(message) {
    errorBox.textContent = message;
    errorBox.hidden = !message;
  }

  function hideConfirm() {
    pendingText = null;
    confirmBox.hidden = true;
    confirmBox.innerHTML = '';
    fileInput.value = '';
  }

  async function exportBackup() {
    showError('');
    try {
      const { json, fileName } = await model.prepareExport();
      const file = new File([json], fileName, { type: 'application/json' });
      if (navigator.canShare?.({ files: [file] })) {
        // iPhone: Teilen-Menü → „In Dateien sichern“, AirDrop, Mail …
        await navigator.share({ files: [file], title: 'FeedYourself-Sicherung' });
      } else {
        download(file);
      }
      await model.confirmExported();
    } catch (error) {
      if (error?.name === 'AbortError') return;   // Teilen abgebrochen
      showError(`Die Sicherung konnte nicht erstellt werden: ${error?.message ?? error}`);
    }
  }

  async function chooseFile(file) {
    showError('');
    hideConfirm();
    if (!file) return;
    try {
      const text = await readText(file);
      const info = model.previewImport(text);
      pendingText = text;
      const listed = info.entries === 1 ? '1 Produkt auf der Liste' : `${info.entries} Produkte auf der Liste`;
      confirmBox.innerHTML = `
        <p><strong>Sicherung vom ${esc(formatDate(info.exportedAt))}</strong><br>
        ${info.products} Produkte · ${info.categories} Kategorien · ${listed}</p>
        <p>Deine aktuellen Daten werden dadurch ersetzt. Das lässt sich direkt danach rückgängig machen.</p>
        <div class="backup-actions">
          <button type="button" class="button secondary" data-cancel-import>Abbrechen</button>
          <button type="button" class="button primary" data-confirm-import>Ersetzen</button>
        </div>`;
      confirmBox.hidden = false;
      confirmBox.querySelector('[data-confirm-import]').focus({ preventScroll: true });
    } catch (error) {
      fileInput.value = '';
      showError(error?.message ?? String(error));
    }
  }

  root.addEventListener('click', async (event) => {
    const t = event.target;
    if (t.closest('[data-export]')) await exportBackup();
    else if (t.closest('[data-import]')) fileInput.click();
    else if (t.closest('[data-cancel-import]')) hideConfirm();
    else if (t.closest('[data-confirm-import]') && pendingText) {
      const text = pendingText;
      hideConfirm();
      try {
        await model.importBackup(text);
      } catch (error) {
        showError(error?.message ?? String(error));
      }
    }
  });
  fileInput.addEventListener('change', () => chooseFile(fileInput.files?.[0]));

  function render() {
    const at = model.state.lastBackupAt;
    if (!at) {
      status.textContent = 'Noch nie gesichert.';
      status.classList.add('due');
      return;
    }
    const days = (Date.now() - at) / 86_400_000;
    status.textContent = `Zuletzt gesichert: ${formatDate(at)}${days > REMIND_AFTER_DAYS ? ' – Zeit für eine neue Sicherung.' : ''}`;
    status.classList.toggle('due', days > REMIND_AFTER_DAYS);
  }

  model.subscribe(render);
  render();
}

/** Dateiinhalt als Text – mit Ausweichweg für Browser ohne Blob.text(). */
export function readText(file) {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Die Datei konnte nicht gelesen werden.'));
    reader.readAsText(file);
  });
}

function download(file) {
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
