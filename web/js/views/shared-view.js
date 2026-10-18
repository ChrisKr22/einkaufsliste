// Listen: Abschnitt in den Einstellungen, Listenwechsler im Kopf, Dialoge für Beitritt und Beitrittsanfragen.

import { esc } from './dom.js';

const DEVICE_KEY = 'fy-device-name';
const people = '<svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.2"/><path d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5"/><circle cx="17" cy="9" r="2.5"/><path d="M15.8 14.2c2.3.2 3.9 1.8 4.4 4.3"/></svg>';

function defaultDeviceName() {
  try {
    const saved = localStorage.getItem(DEVICE_KEY);
    if (saved) return saved;
  } catch { /* ohne Speicher */ }
  const ua = navigator.userAgent ?? '';
  return /iPhone/.test(ua) ? 'Mein iPhone' : /iPad/.test(ua) ? 'Mein iPad' : 'Mein Gerät';
}

function rememberDeviceName(name) {
  try { localStorage.setItem(DEVICE_KEY, name); } catch { /* egal */ }
}

function ago(time, now = Date.now()) {
  if (!time) return 'noch nicht';
  const s = Math.max(0, Math.round((now - time) / 1000));
  if (s < 15) return 'gerade eben';
  if (s < 60) return `vor ${s} Sekunden`;
  const m = Math.round(s / 60);
  if (m < 60) return m === 1 ? 'vor 1 Minute' : `vor ${m} Minuten`;
  return `um ${new Date(time).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr`;
}

const clock = (time) => new Date(time).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

const lock = '<svg aria-hidden="true" viewBox="0 0 24 24"><rect x="5" y="10.5" width="14" height="9.5" rx="2.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/></svg>';
const check = '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const chevron = '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M7 10l5 5 5-5"/></svg>';

/**
 * Einstellungen › „Listen“: Übersicht (gemeinsam, privat), die geöffnete gemeinsame Liste (Mitglieder, Einladen,
 * Verlassen), „Neue Liste“ (privat oder gemeinsam) und „Einladung erhalten?“.
 */
export function mountListsSection(root, lists, shared, model) {
  let invite = null;          // { link, text, expires } – vorbereitet, damit „Teilen“ direkt nach dem Tippen kommt
  let confirmLeave = false;
  let confirmRemove = null;   // Mitglieds-ID, die der Admin entfernen möchte
  let confirmDelete = null;   // private Liste, die gelöscht werden soll
  let renaming = null;        // private Liste, die gerade umbenannt wird
  let newKind = 'private';
  let busy = false;
  let error = '';
  let joinError = '';

  function useInvite(text) {
    joinError = '';
    if (!shared.receiveInvite(text)) joinError = 'Darin ist keine Einladung zu einer gemeinsamen Liste enthalten.';
    else root.querySelector('#shared-invite').value = '';
    render();
  }

  async function run(work) {
    if (busy) return;
    busy = true;
    error = '';
    render();
    try {
      await work();
    } catch (e) {
      error = e?.message ?? String(e);
    }
    busy = false;
    render();
  }

  root.addEventListener('click', async (event) => {
    const t = event.target;
    const listButton = t.closest('[data-list-open]');
    if (listButton) {
      invite = null;
      confirmLeave = false;
      await run(() => lists.switchTo(listButton.dataset.listOpen));
    } else if (t.closest('[data-list-kind]')) {
      newKind = t.closest('[data-list-kind]').dataset.listKind;
      render();
    } else if (t.closest('[data-list-create]')) {
      const name = root.querySelector('#new-list-name').value;
      if (newKind === 'private') {
        await run(async () => { await lists.createPrivate(name); root.querySelector('#new-list-name').value = ''; });
      } else {
        const deviceName = root.querySelector('#shared-device').value;
        const adopt = root.querySelector('#shared-adopt')?.checked ?? false;
        rememberDeviceName(deviceName.trim());
        await run(() => lists.createShared({ name, deviceName, adopt }));
      }
    } else if (t.closest('[data-list-rename]')) {
      renaming = t.closest('[data-list-rename]').dataset.listRename;
      render();
      root.querySelector('#rename-list')?.select();
    } else if (t.closest('[data-list-rename-save]')) {
      const id = renaming;
      const name = root.querySelector('#rename-list').value;   // vor dem Neuzeichnen lesen
      renaming = null;
      await run(() => lists.rename(id, name));
    } else if (t.closest('[data-list-delete]')) {
      confirmDelete = t.closest('[data-list-delete]').dataset.listDelete;
      render();
    } else if (t.closest('[data-list-delete-cancel]')) {
      confirmDelete = null;
      render();
    } else if (t.closest('[data-list-delete-confirm]')) {
      const id = confirmDelete;
      confirmDelete = null;
      await run(() => lists.deletePrivate(id));
    } else if (t.closest('[data-shared-join]')) {
      useInvite(root.querySelector('#shared-invite').value);
    } else if (t.closest('[data-shared-paste]')) {
      try {
        const text = await navigator.clipboard.readText();
        root.querySelector('#shared-invite').value = text;
        useInvite(text);
      } catch {
        joinError = 'Kein Zugriff auf die Zwischenablage – bitte lange ins Feld tippen, „Einsetzen“ wählen und dann „Einladung einfügen“.';
        render();
      }
    } else if (t.closest('[data-shared-invite]')) {
      await run(async () => { invite = await shared.invite(); });
    } else if (t.closest('[data-shared-share]')) {
      if (!invite) return;
      if (navigator.share) {
        try {
          await navigator.share({ title: 'Einladung zur Einkaufsliste', text: invite.text });
          return;
        } catch (e) {
          if (e?.name === 'AbortError') return;
        }
      }
      await copyInvite();
    } else if (t.closest('[data-shared-copy]')) {
      await copyInvite();
    } else if (t.closest('[data-shared-leave]')) {
      confirmLeave = true;
      render();
    } else if (t.closest('[data-shared-leave-cancel]')) {
      confirmLeave = false;
      render();
    } else if (t.closest('[data-member-remove]')) {
      confirmRemove = t.closest('[data-member-remove]').dataset.memberRemove;
      render();
    } else if (t.closest('[data-member-remove-cancel]')) {
      confirmRemove = null;
      render();
    } else if (t.closest('[data-member-remove-confirm]')) {
      const id = confirmRemove;
      confirmRemove = null;
      await run(() => shared.removeMember(id));
    } else if (t.closest('[data-shared-leave-confirm]')) {
      confirmLeave = false;
      invite = null;
      await run(() => shared.leave());
    }
  });
  root.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && event.target.id === 'rename-list') root.querySelector('[data-list-rename-save]')?.click();
  });

  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(invite.text);
      model.notify('Einladung kopiert – jetzt in Nachrichten o. Ä. einfügen');
    } catch {
      model.notify('Kopieren ist in diesem Browser nicht möglich');
    }
  }

  function listRow(list) {
    const active = list.id === lists.state.activeId;
    const icon = list.kind === 'shared' ? people : lock;
    if (renaming === list.id) {
      return `<li class="list-row editing">${icon}<input id="rename-list" type="text" maxlength="40" value="${esc(list.name)}" aria-label="Name der Liste" autocomplete="off">
        <button type="button" class="text-button" data-list-rename-save>Fertig</button></li>`;
    }
    if (confirmDelete === list.id) {
      return `<li class="list-row member-confirm"><span class="member-name">„${esc(list.name)}“ mit allen Einträgen löschen?</span>
        <span class="member-actions"><button type="button" class="text-button" data-list-delete-cancel>Abbrechen</button>
        <button type="button" class="text-button danger" data-list-delete-confirm>Löschen</button></span></li>`;
    }
    const canDelete = list.kind === 'private' && lists.state.lists.length > 1;
    return `<li class="list-row${active ? ' active' : ''}">
      <button type="button" class="list-open" data-list-open="${esc(list.id)}" aria-pressed="${active}" ${busy ? 'disabled' : ''}>${icon}<span>${esc(list.name)}</span>${active ? `<i class="list-check">${check}</i>` : ''}</button>
      ${list.kind === 'private' ? `<button type="button" class="text-button" data-list-rename="${esc(list.id)}">Umbenennen</button>` : ''}
      ${canDelete ? `<button type="button" class="text-button danger" data-list-delete="${esc(list.id)}" aria-label="${esc(list.name)} löschen">Löschen</button>` : ''}
    </li>`;
  }

  function sharedDetail() {
    const s = shared.state;
    const errorHtml = error ? `<p class="backup-error" role="alert">${esc(error)}</p>` : '';
    if (s.status === 'lost') {
      return `<div class="card shared-card">
          <p class="shared-lost"><strong>${esc(s.name)}</strong>: ${esc(s.error ?? 'Kein Zugang mehr.')}</p>
          <button type="button" class="button secondary" data-shared-leave-confirm ${busy ? 'disabled' : ''}>Liste von diesem Gerät entfernen</button>
          ${errorHtml}
        </div>`;
    }
    if (confirmRemove && !s.members.some((m) => m.id === confirmRemove)) confirmRemove = null;
    const members = s.members.map((m) => {
      const tags = [m.me && 'dieses Gerät', m.admin && 'Admin'].filter(Boolean).join(', ');
      const removable = s.isAdmin && !m.me;
      if (confirmRemove === m.id) {
        return `<li class="member-confirm"><span class="member-name">„${esc(m.name)}“ entfernen? Das Gerät hat danach sofort keinen Zugang mehr.</span>
          <span class="member-actions"><button type="button" class="text-button" data-member-remove-cancel>Abbrechen</button>
          <button type="button" class="text-button danger" data-member-remove-confirm>Entfernen</button></span></li>`;
      }
      return `<li><span class="member-name">${esc(m.name)}${tags ? ` <span>(${tags})</span>` : ''}</span>`
        + `${removable ? `<button type="button" class="text-button" data-member-remove="${esc(m.id)}" aria-label="${esc(m.name)} entfernen" ${busy ? 'disabled' : ''}>Entfernen</button>` : ''}</li>`;
    }).join('');
    const inviteHtml = invite ? `
      <div class="invite-ready">
        <p>Einladung bereit – gilt bis ${clock(invite.expires)} Uhr. Verschicken, z. B. per Nachricht:</p>
        <div class="backup-actions">
          <button type="button" class="button primary" data-shared-share>Teilen</button>
          <button type="button" class="button secondary" data-shared-copy>Kopieren</button>
        </div>
      </div>` : '';
    const full = s.memberCount >= s.maxMembers;
    return `
      <div class="card shared-card">
        <div class="shared-head">${people}<div><strong>${esc(s.name)}</strong>
          <span>${s.memberCount} von ${s.maxMembers} Geräten · abgeglichen ${ago(s.lastSync)}${s.error ? ' · offline' : ''}</span></div></div>
        <ul class="shared-members">${members}</ul>
        ${inviteHtml}
        ${confirmLeave ? `
          <p class="shared-confirm">„${esc(s.name)}“ auf diesem Gerät verlassen? Die anderen behalten die Liste.</p>
          <div class="backup-actions">
            <button type="button" class="button secondary" data-shared-leave-cancel>Abbrechen</button>
            <button type="button" class="button primary" data-shared-leave-confirm>Verlassen</button>
          </div>` : `
          <div class="backup-actions">
            <button type="button" class="button primary" data-shared-invite ${busy || full ? 'disabled' : ''}>${full ? 'Liste ist voll' : invite ? 'Neue Einladung' : 'Mitglied einladen'}</button>
            <button type="button" class="button secondary" data-shared-leave ${busy ? 'disabled' : ''}>Verlassen</button>
          </div>`}
        ${errorHtml}
      </div>
      <p class="section-note">Eine Einladung gilt 30 Minuten; beim Beitritt zeigen beide Geräte einen Prüfcode. ${s.isAdmin ? 'Du bist Admin dieser Liste und kannst Mitglieder entfernen.' : 'Mitglieder entfernen kann der Admin der Liste.'}</p>`;
  }

  function newListCard() {
    const active = lists.active;
    const count = model.state.items.length;
    const canAdopt = newKind === 'shared' && active?.kind === 'private' && count > 0;
    return `
      <div class="card shared-card">
        <strong>Neue Liste</strong>
        <div class="theme-choice list-kind" role="radiogroup" aria-label="Art der Liste">
          <button type="button" role="radio" data-list-kind="private" aria-checked="${newKind === 'private'}">Privat</button>
          <button type="button" role="radio" data-list-kind="shared" aria-checked="${newKind === 'shared'}">Gemeinsam</button>
        </div>
        <p class="shared-confirm">${newKind === 'private'
          ? 'Nur auf diesem Gerät – nichts verlässt das iPhone.'
          : 'Für mehrere Geräte (höchstens 5) – Änderungen erscheinen nach wenigen Sekunden bei allen. Die Inhalte sind verschlüsselt, nur die Mitglieder können sie lesen.'}</p>
        <label class="shared-field"><span>Name der Liste</span><input id="new-list-name" type="text" maxlength="40" placeholder="${newKind === 'private' ? 'z. B. Baumarkt' : 'z. B. Zuhause'}" autocomplete="off"></label>
        ${newKind === 'shared' ? `<label class="shared-field"><span>Name dieses Geräts</span><input id="shared-device" type="text" maxlength="40" value="${esc(defaultDeviceName())}" autocomplete="off"></label>` : ''}
        ${canAdopt ? `<label class="shared-check"><input id="shared-adopt" type="checkbox"><span>Einträge aus „${esc(active.name)}“ übernehmen (${count === 1 ? '1 Artikel' : `${count} Artikel`})</span></label>` : ''}
        <button type="button" class="button primary" data-list-create ${busy ? 'disabled' : ''}>${busy ? 'Wird angelegt …' : 'Liste anlegen'}</button>
      </div>`;
  }

  function build() {
    if (invite && invite.expires <= Date.now()) invite = null;
    const all = lists.state.lists;
    const sharedLists = all.filter((l) => l.kind === 'shared');
    const privateLists = all.filter((l) => l.kind === 'private');
    const activeShared = lists.active?.kind === 'shared' && shared.state.status !== 'none';
    return `
      <h3 class="section-title" id="lists-title">Listen</h3>
      ${sharedLists.length ? `<p class="list-group">Gemeinsam</p><ul class="card list-rows">${sharedLists.map(listRow).join('')}</ul>` : ''}
      ${activeShared ? sharedDetail() : ''}
      <p class="list-group">Privat</p>
      <ul class="card list-rows">${privateLists.map(listRow).join('')}</ul>
      ${!activeShared && error ? `<p class="backup-error" role="alert">${esc(error)}</p>` : ''}
      ${newListCard()}
      <div class="card shared-card shared-join">
        <strong>Einladung erhalten?</strong>
        <p class="shared-confirm">Nachricht oder Link aus der Einladung kopieren und hier einfügen – dann den Prüfcode vergleichen.</p>
        <label class="sr-only" for="shared-invite">Einladung</label>
        <input id="shared-invite" class="shared-invite" type="text" placeholder="Einladung hier einfügen" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">
        <div class="backup-actions">
          <button type="button" class="button secondary" data-shared-paste>Aus Zwischenablage</button>
          <button type="button" class="button primary" data-shared-join>Einladung einfügen</button>
        </div>
        ${joinError ? `<p class="backup-error" role="alert">${esc(joinError)}</p>` : ''}
      </div>`;
  }

  let last = '';
  function render() {
    // Beim Tippen in ein Feld nicht neu zeichnen – sonst wäre die Eingabe weg
    const typing = root.contains(document.activeElement) && document.activeElement.matches?.('input');
    if (typing && !busy) return;
    const html = build();
    if (html === last) return;   // nichts geändert – Fokus und VoiceOver-Position bleiben
    last = html;
    root.innerHTML = html;
  }

  shared.subscribe(() => { if (!busy) render(); });
  lists.subscribe(() => { if (!busy) render(); });
  model.subscribe(() => { if (!busy) render(); });
  setInterval(() => { if (shared.state.status === 'active' && !busy) render(); }, 15_000).unref?.();
  render();
}

/**
 * Listenwechsler im Kopf: zeigt die geöffnete Liste. Tippen öffnet die Auswahl, langes Drücken die Einstellungen.
 * @param {{openSettings: (focus?: string) => void}} options
 */
export function mountListSwitch(button, menu, lists, shared, { openSettings }) {
  let pressTimer = null;
  let longPressed = false;

  const close = () => {
    menu.hidden = true;
    button.setAttribute('aria-expanded', 'false');
  };
  const open = () => {
    renderMenu();
    menu.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    menu.querySelector('[aria-checked="true"]')?.focus({ preventScroll: true });
  };

  button.addEventListener('pointerdown', () => {
    longPressed = false;
    clearTimeout(pressTimer);
    pressTimer = setTimeout(() => {
      longPressed = true;
      close();
      navigator.vibrate?.(10);
      openSettings('#lists-section');
    }, 500);
  });
  const cancelPress = () => clearTimeout(pressTimer);
  button.addEventListener('pointerup', cancelPress);
  button.addEventListener('pointerleave', cancelPress);
  button.addEventListener('pointercancel', cancelPress);
  button.addEventListener('contextmenu', (event) => event.preventDefault());   // kein Kontextmenü beim langen Drücken
  button.addEventListener('click', (event) => {
    if (longPressed) {
      longPressed = false;
      event.preventDefault();
      return;
    }
    if (menu.hidden) open();
    else close();
  });

  menu.addEventListener('click', async (event) => {
    const item = event.target.closest('[data-switch-list]');
    if (item) {
      close();
      await lists.switchTo(item.dataset.switchList);
    } else if (event.target.closest('[data-new-list]')) {
      close();
      openSettings('#lists-section');
    }
  });
  document.addEventListener('click', (event) => {
    if (!menu.hidden && !menu.contains(event.target) && !button.contains(event.target)) close();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !menu.hidden) {
      close();
      button.focus();
    }
  });

  function renderMenu() {
    const items = lists.state.lists.map((l) => {
      const active = l.id === lists.state.activeId;
      return `<button type="button" role="menuitemradio" aria-checked="${active}" data-switch-list="${esc(l.id)}">
        ${l.kind === 'shared' ? people : lock}<span>${esc(l.name)}</span>${active ? `<i class="list-check">${check}</i>` : ''}</button>`;
    }).join('');
    menu.innerHTML = `${items}<hr><button type="button" role="menuitem" data-new-list><span>Neue Liste …</span></button>`;
  }

  function render() {
    const list = lists.active;
    if (!list) return;
    const s = shared.state;
    const requests = list.kind === 'shared' && s.requests.length > 0;
    button.innerHTML = `${list.kind === 'shared' ? people : lock}<span>${esc(list.name)}</span>${chevron}${requests ? '<i aria-hidden="true"></i>' : ''}`;
    button.classList.toggle('shared', list.kind === 'shared');
    button.classList.toggle('problem', list.kind === 'shared' && s.status === 'lost');
    button.setAttribute('aria-label', `Liste: ${list.name}${list.kind === 'shared' ? ' (gemeinsam)' : ''}${requests ? ', Beitrittsanfrage offen' : ''} – tippen zum Wechseln, lange drücken für die Einstellungen`);
    if (!menu.hidden) renderMenu();
  }
  lists.subscribe(render);
  shared.subscribe(render);
  render();
}

/** Dialoge: „Beitreten?“ (neues Gerät) und „Beitrittsanfrage“ (Mitglied). */
export function mountSharedDialogs(root, shared, model) {
  const dismissed = new Set();   // Anfragen, die man mit „Später“ weggelegt hat
  let shownKey = null;
  let copied = false;            // „In der App beitreten“: Link wurde kopiert

  root.addEventListener('click', async (event) => {
    const t = event.target;
    const request = shared.state.requests.find((r) => !dismissed.has(r.rid));
    if (t.closest('[data-join-copy]')) {
      try {
        await navigator.clipboard.writeText(shared.state.join?.link ?? '');
        copied = true;
      } catch {
        copied = false;
        t.closest('button').textContent = 'Kopieren nicht möglich';
      }
      render();
    } else if (t.closest('[data-join-here]')) {
      shared.joinHere();
    } else if (t.closest('[data-join-send]')) {
      const name = root.querySelector('#join-device').value;
      rememberDeviceName(name.trim());
      t.closest('button').disabled = true;
      await shared.sendJoin(name);
    } else if (t.closest('[data-join-cancel]')) {
      await shared.cancelJoin();
    } else if (t.closest('[data-join-close]')) {
      shared.dismissJoin();
    } else if (t.closest('[data-request-approve]') && request) {
      t.closest('button').disabled = true;
      try {
        await shared.approve(request.rid);
        model.notify(`${request.device || 'Neues Gerät'} ist jetzt dabei`);
      } catch (e) {
        model.notify(e?.message ?? String(e));
      }
    } else if (t.closest('[data-request-reject]') && request) {
      try { await shared.reject(request.rid); } catch (e) { model.notify(e?.message ?? String(e)); }
    } else if (t.closest('[data-request-later]') && request) {
      dismissed.add(request.rid);
      render();
    }
  });

  function sheet(content, closeAttr) {
    return `<button type="button" class="sheet-backdrop" ${closeAttr} aria-label="Schließen"></button>
      <div class="sheet shared-sheet" role="dialog" aria-modal="true" aria-labelledby="shared-dialog-title">
        <div class="sheet-grabber" aria-hidden="true"></div>${content}</div>`;
  }

  function render() {
    const { join, requests, status } = shared.state;
    const waiting = status === 'active' ? requests.filter((r) => !dismissed.has(r.rid)) : [];
    const request = waiting[0] ?? null;
    if (join?.phase !== 'elsewhere') copied = false;
    const key = join ? `join:${join.phase}:${join.code ?? ''}:${join.message ?? ''}:${copied}` : request ? `req:${request.rid}:${waiting.length > 1}` : null;
    if (key === shownKey) return;
    shownKey = key;
    document.body.classList.toggle('sheet-open', Boolean(key));
    if (!key) {
      root.innerHTML = '';
      return;
    }
    const listName = esc(join?.name || 'gemeinsamen Liste');
    if (join?.phase === 'elsewhere') {
      root.innerHTML = sheet(`
        <div><h2 id="shared-dialog-title">In der App beitreten</h2>
        <p class="section-note">Du bist in Safari. Safari und FeedYourself auf dem Home-Bildschirm speichern getrennt – damit „${listName}“ in der App landet:</p></div>
        <ol class="join-steps">
          <li>${copied ? '<strong>Link kopiert ✓</strong>' : 'Link kopieren'}</li>
          <li>FeedYourself vom Home-Bildschirm öffnen</li>
          <li>Einstellungen › Gemeinsame Liste › <strong>Einladung einfügen</strong></li>
        </ol>
        <p class="section-note">Noch keine App auf dem Home-Bildschirm? In Safari auf <strong>Teilen › Zum Home-Bildschirm</strong> – danach wie oben. Die Einladung gilt 30 Minuten.</p>
        <button type="button" class="button primary" data-join-copy>${copied ? 'Nochmal kopieren' : 'Link kopieren'}</button>
        <button type="button" class="text-button" data-join-here>Lieber hier in Safari beitreten</button>`, 'data-join-close');
    } else if (join?.phase === 'form') {
      root.innerHTML = sheet(`
        <div><h2 id="shared-dialog-title">Der Liste „${listName}“ beitreten?</h2>
        <p class="section-note">Ein Mitglied muss den Beitritt bestätigen. Deine bisherige Liste bleibt auf diesem Gerät gespeichert und ist wieder da, wenn du die gemeinsame Liste verlässt.</p></div>
        <label class="shared-field"><span>Name dieses Geräts (sehen nur die Mitglieder)</span><input id="join-device" type="text" maxlength="40" value="${esc(defaultDeviceName())}" autocomplete="off"></label>
        <div class="sheet-actions">
          <button type="button" class="button secondary" data-join-close>Abbrechen</button>
          <button type="button" class="button primary" data-join-send>Anfrage senden</button>
        </div>`, 'data-join-close');
    } else if (join?.phase === 'waiting') {
      root.innerHTML = sheet(`
        <div><h2 id="shared-dialog-title">Warte auf Bestätigung</h2>
        <p class="section-note">Ein Mitglied von „${listName}“ sieht jetzt deine Anfrage. Vergleicht den Prüfcode – er muss auf beiden Geräten gleich sein:</p></div>
        <p class="join-code" aria-label="Prüfcode ${esc(join.code.split('').join(' '))}">${esc(join.code)}</p>
        <p class="section-note">Du kannst die App solange schließen; beim nächsten Öffnen geht es weiter.</p>
        <button type="button" class="button secondary" data-join-cancel>Anfrage zurückziehen</button>`, '');
    } else if (join?.phase === 'failed') {
      root.innerHTML = sheet(`
        <div><h2 id="shared-dialog-title">Beitritt nicht möglich</h2>
        <p class="section-note">${esc(join.message ?? '')}</p></div>
        <button type="button" class="button primary" data-join-close>OK</button>`, 'data-join-close');
    } else if (request) {
      root.innerHTML = sheet(`
        <div><h2 id="shared-dialog-title">Beitrittsanfrage</h2>
        <p class="section-note">„${esc(request.device || 'Neues Gerät')}“ möchte „${esc(shared.state.name)}“ beitreten. Zeigt das andere Gerät denselben Prüfcode?</p>
        ${waiting.length > 1 ? `<p class="section-note"><strong>Es warten ${waiting.length} Anfragen.</strong> Nur bestätigen, wenn du weißt, von welchem Gerät diese kommt – sonst ablehnen und eine neue Einladung schicken.</p>` : ''}</div>
        <p class="join-code" aria-label="Prüfcode ${esc(request.code.split('').join(' '))}">${esc(request.code)}</p>
        <div class="sheet-actions">
          <button type="button" class="button secondary" data-request-reject>Ablehnen</button>
          <button type="button" class="button primary" data-request-approve>Bestätigen</button>
        </div>
        <button type="button" class="text-button" data-request-later>Später</button>`, 'data-request-later');
    }
  }

  shared.subscribe(render);
  render();
}
