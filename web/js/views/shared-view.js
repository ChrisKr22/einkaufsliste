// Gemeinsame Liste: Abschnitt in den Einstellungen, Hinweis im Kopf, Dialoge für Beitritt und Beitrittsanfragen.

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

/** Einstellungen › „Gemeinsame Liste“ */
export function mountSharedSection(root, shared, model) {
  let invite = null;          // { link, text, expires } – vorbereitet, damit „Teilen“ direkt nach dem Tippen kommt
  let confirmLeave = false;
  let confirmRemove = null;   // Mitglieds-ID, die der Admin entfernen möchte
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
    if (t.closest('[data-shared-create]')) {
      const name = root.querySelector('#shared-name').value;
      const deviceName = root.querySelector('#shared-device').value;
      const adopt = root.querySelector('#shared-adopt')?.checked ?? false;
      rememberDeviceName(deviceName.trim());
      await run(() => shared.create({ name, deviceName, adopt }));
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

  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(invite.text);
      model.notify('Einladung kopiert – jetzt in Nachrichten o. Ä. einfügen');
    } catch {
      model.notify('Kopieren ist in diesem Browser nicht möglich');
    }
  }

  function build() {
    const s = shared.state;
    if (invite && invite.expires <= Date.now()) invite = null;
    const errorHtml = error ? `<p class="backup-error" role="alert">${esc(error)}</p>` : '';
    if (s.status === 'none') {
      const count = model.state.items.length;
      return `
        <h3 class="section-title" id="shared-title">Gemeinsame Liste</h3>
        <p class="section-note">Eine Liste für mehrere Geräte – Änderungen erscheinen nach wenigen Sekunden bei allen, solange die App offen ist. Höchstens 5 Geräte; die Inhalte sind verschlüsselt, nur die Mitglieder können sie lesen.</p>
        <div class="card shared-card">
          <label class="shared-field"><span>Name der Liste</span><input id="shared-name" type="text" maxlength="40" value="Zuhause" autocomplete="off"></label>
          <label class="shared-field"><span>Name dieses Geräts</span><input id="shared-device" type="text" maxlength="40" value="${esc(defaultDeviceName())}" autocomplete="off"></label>
          ${count ? `<label class="shared-check"><input id="shared-adopt" type="checkbox" checked><span>Meine bisherige Liste übernehmen (${count === 1 ? '1 Artikel' : `${count} Artikel`})</span></label>` : ''}
          <button type="button" class="button primary" data-shared-create ${busy ? 'disabled' : ''}>${busy ? 'Wird angelegt …' : 'Gemeinsame Liste anlegen'}</button>
          ${errorHtml}
        </div>
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
    if (s.status === 'lost') {
      return `
        <h3 class="section-title" id="shared-title">Gemeinsame Liste</h3>
        <div class="card shared-card">
          <p class="shared-lost"><strong>${esc(s.name)}</strong>: ${esc(s.error ?? 'Kein Zugang mehr.')}</p>
          <button type="button" class="button secondary" data-shared-leave-confirm ${busy ? 'disabled' : ''}>Liste entfernen und eigene Liste zurückholen</button>
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
      <h3 class="section-title" id="shared-title">Gemeinsame Liste</h3>
      <div class="card shared-card">
        <div class="shared-head">${people}<div><strong>${esc(s.name)}</strong>
          <span>${s.memberCount} von ${s.maxMembers} Geräten · abgeglichen ${ago(s.lastSync)}${s.error ? ' · offline' : ''}</span></div></div>
        <ul class="shared-members">${members}</ul>
        ${inviteHtml}
        ${confirmLeave ? `
          <p class="shared-confirm">Liste auf diesem Gerät verlassen? Die anderen behalten sie; deine bisherige eigene Liste kommt zurück.</p>
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
      <p class="section-note">Eine Einladung gilt 30 Minuten. Beim Beitritt zeigen beide Geräte einen Prüfcode – vergleicht ihn, bevor du bestätigst. ${s.isAdmin ? 'Du bist Admin dieser Liste und kannst Mitglieder entfernen.' : 'Mitglieder entfernen kann der Admin der Liste.'}</p>`;
  }

  let last = '';
  function render() {
    const html = build();
    if (html === last) return;   // nichts geändert – Fokus und VoiceOver-Position bleiben
    last = html;
    root.innerHTML = html;
  }

  shared.subscribe(() => { if (!busy) render(); });
  model.subscribe(() => { if (shared.state.status === 'none' && !busy && !root.contains(document.activeElement)) render(); });
  setInterval(() => { if (shared.state.status === 'active' && !busy && !root.contains(document.activeElement)) render(); }, 15_000).unref?.();
  render();
}

/** Kleiner Hinweis im Kopf: Name der gemeinsamen Liste; Tippen öffnet die Einstellungen. */
export function mountSharedChip(button, shared) {
  function render() {
    const s = shared.state;
    button.hidden = s.status === 'none';
    if (button.hidden) return;
    button.innerHTML = `${people}<span>${esc(s.name)}</span>${s.requests.length ? '<i aria-hidden="true"></i>' : ''}`;
    button.classList.toggle('problem', s.status === 'lost');
    button.setAttribute('aria-label', `Gemeinsame Liste ${s.name}${s.requests.length ? ', Beitrittsanfrage offen' : ''}`);
  }
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
    const request = status === 'active' ? requests.find((r) => !dismissed.has(r.rid)) : null;
    if (join?.phase !== 'elsewhere') copied = false;
    const key = join ? `join:${join.phase}:${join.code ?? ''}:${join.message ?? ''}:${copied}` : request ? `req:${request.rid}` : null;
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
        <p class="section-note">„${esc(request.device || 'Neues Gerät')}“ möchte „${esc(shared.state.name)}“ beitreten. Zeigt das andere Gerät denselben Prüfcode?</p></div>
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
