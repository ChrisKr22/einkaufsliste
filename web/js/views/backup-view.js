// Einstellungen › Sicherung: Daten als Datei exportieren (Teilen-Menü bzw. Download) und wieder einspielen.

import { MIN_PASSWORD } from '../data/backup.js';
import { esc } from './dom.js';

const REMIND_AFTER_DAYS = 30;
const formatDate = (value) => new Date(value).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });

export function mountBackupSection(root, model) {
  const status = root.querySelector('#backup-status');
  const fileInput = root.querySelector('#backup-file');
  const confirmBox = root.querySelector('#backup-confirm');
  const errorBox = root.querySelector('#backup-error');
  let pendingText = null;
  let prepared = null;       // fertige Datei mit Passwort-Tresor – „Sichern“ gibt sie direkt nach dem Tippen weiter

  function showError(message) {
    errorBox.textContent = message;
    errorBox.hidden = !message;
  }

  function hideConfirm() {
    pendingText = null;
    prepared = null;
    confirmBox.hidden = true;
    confirmBox.innerHTML = '';
    fileInput.value = '';
  }

  function showBox(html, focus) {
    confirmBox.innerHTML = html;
    confirmBox.hidden = false;
    confirmBox.querySelector(focus)?.focus({ preventScroll: true });
  }

  /** Datei weitergeben: iPhone-Teilen-Menü („In Dateien sichern“, AirDrop, Mail …) oder Download. */
  async function deliver({ json, fileName }) {
    const file = new File([json], fileName, { type: 'application/json' });
    if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: 'FeedYourself-Sicherung' });
    else download(file);
    await model.confirmExported();
  }

  async function exportBackup({ password = '' } = {}) {
    showError('');
    try {
      await deliver(await model.prepareExport({ password }));
      hideConfirm();
    } catch (error) {
      if (error?.name === 'AbortError') return;   // Teilen abgebrochen
      showError(`Die Sicherung konnte nicht erstellt werden: ${error?.message ?? error}`);
    }
  }

  /** Export: Gibt es gemeinsame Listen, erst nach dem Passwort für deren Zugänge fragen. */
  async function startExport() {
    showError('');
    hideConfirm();
    const count = await model.backupAccessCount();
    if (!count) {
      await exportBackup();
      return;
    }
    const lists = count === 1 ? 'einer gemeinsamen Liste' : `${count} gemeinsamen Listen`;
    showBox(`
      <p><strong>Zugänge zu ${lists}</strong><br>
      Mit Passwort kommen sie verschlüsselt in die Sicherung. Ohne Passwort fehlen sie – nach dem Einspielen trittst du den Listen neu bei.</p>
      <label class="shared-field"><span>Passwort (mindestens ${MIN_PASSWORD} Zeichen)</span><input id="backup-pass" type="password" autocomplete="new-password" minlength="${MIN_PASSWORD}"></label>
      <label class="shared-field"><span>Passwort wiederholen</span><input id="backup-pass2" type="password" autocomplete="new-password"></label>
      <p>Das Passwort wird nirgends gespeichert. Ohne es lassen sich die Zugänge nicht wiederherstellen.</p>
      <div class="backup-actions">
        <button type="button" class="button primary" data-export-sealed>Mit Passwort sichern</button>
        <button type="button" class="button secondary" data-export-plain>Ohne gemeinsame Listen</button>
      </div>
      <button type="button" class="text-button" data-cancel-import>Abbrechen</button>`, '#backup-pass');
  }

  async function exportSealed() {
    const password = confirmBox.querySelector('#backup-pass')?.value ?? '';
    const repeat = confirmBox.querySelector('#backup-pass2')?.value ?? '';
    if (password.length < MIN_PASSWORD) return showError(`Das Passwort braucht mindestens ${MIN_PASSWORD} Zeichen.`);
    if (password !== repeat) return showError('Die beiden Passwörter sind verschieden.');
    showError('');
    const button = confirmBox.querySelector('[data-export-sealed]');
    button.disabled = true;
    button.textContent = 'Wird verschlüsselt …';
    try {
      // Verschlüsseln dauert etwa eine Sekunde – Safari öffnet das Teilen-Menü danach nicht mehr, darum zweiter Schritt.
      prepared = await model.prepareExport({ password });
      showBox(`
        <p><strong>Sicherung bereit</strong><br>${prepared.sealed === 1 ? 'Der Zugang zur gemeinsamen Liste ist' : `Die Zugänge zu ${prepared.sealed} gemeinsamen Listen sind`} mit deinem Passwort verschlüsselt.</p>
        <div class="backup-actions">
          <button type="button" class="button primary" data-export-share>Sichern</button>
          <button type="button" class="button secondary" data-cancel-import>Abbrechen</button>
        </div>`, '[data-export-share]');
    } catch (error) {
      button.disabled = false;
      button.textContent = 'Mit Passwort sichern';
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
      const shared = info.vaultCount === 1 ? 'eine gemeinsame Liste' : info.vaultCount ? `${info.vaultCount} gemeinsame Listen` : 'gemeinsame Listen';
      const vault = info.vault ? `
        <label class="shared-field"><span>Passwort für ${shared}</span><input id="backup-pass" type="password" autocomplete="current-password"></label>
        <p>Leer lassen: ohne gemeinsame Listen einspielen. Zugänge, die dieses Gerät schon hat, bleiben.</p>` : '';
      showBox(`
        <p><strong>Sicherung vom ${esc(formatDate(info.exportedAt))}</strong><br>
        ${info.products} Produkte · ${info.categories} Kategorien · ${listed}</p>
        ${vault}
        <p>Deine aktuellen Daten werden dadurch ersetzt. Das lässt sich direkt danach rückgängig machen.</p>
        <div class="backup-actions">
          <button type="button" class="button secondary" data-cancel-import>Abbrechen</button>
          <button type="button" class="button primary" data-confirm-import>Ersetzen</button>
        </div>`, info.vault ? '#backup-pass' : '[data-confirm-import]');
    } catch (error) {
      fileInput.value = '';
      showError(error?.message ?? String(error));
    }
  }

  root.addEventListener('click', async (event) => {
    const t = event.target;
    if (t.closest('[data-export]')) await startExport();
    else if (t.closest('[data-export-sealed]')) await exportSealed();
    else if (t.closest('[data-export-plain]')) await exportBackup();
    else if (t.closest('[data-export-share]') && prepared) {
      try {
        await deliver(prepared);
        hideConfirm();
      } catch (error) {
        if (error?.name !== 'AbortError') showError(`Die Sicherung konnte nicht gespeichert werden: ${error?.message ?? error}`);
      }
    } else if (t.closest('[data-import]')) fileInput.click();
    else if (t.closest('[data-cancel-import]')) { hideConfirm(); showError(''); }
    else if (t.closest('[data-confirm-import]') && pendingText) {
      const text = pendingText;
      const password = confirmBox.querySelector('#backup-pass')?.value ?? '';
      const button = t.closest('[data-confirm-import]');
      button.disabled = true;
      try {
        await model.importBackup(text, { password });
        hideConfirm();
        showError('');
      } catch (error) {
        // Falsches Passwort: nichts geändert, Eingabe bleibt offen
        button.disabled = false;
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
