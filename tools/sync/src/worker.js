// Einstieg bei Cloudflare: leitet jede Anfrage an den Briefkasten (Durable Object) ihrer Liste weiter.

import { CORS, json, Mailbox, parsePath } from './mailbox.js';

// Briefkästen liegen nur in Rechenzentren der EU. Nicht nachträglich ändern: Briefkästen eines anderen
// Speicherorts wären danach nicht mehr auffindbar.
export const JURISDICTION = 'eu';

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const url = new URL(request.url);
    if (url.pathname === '/' || url.pathname === '/v1') return json({ service: 'feedyourself-sync', ok: true });
    const path = parsePath(url.pathname);
    if (!path) return json({ error: 'unbekannt' }, 404);
    const namespace = env.MAILBOX.jurisdiction(JURISDICTION);
    return namespace.get(namespace.idFromName(path.listId)).fetch(request);
  },
};

/** Ein Briefkasten pro Liste, mit eigenem SQLite-Speicher. */
export class ListMailbox {
  constructor(ctx) {
    this.mailbox = new Mailbox({
      sql: ctx.storage.sql,
      deleteAll: () => ctx.storage.deleteAll(),
      setAlarm: (at) => ctx.storage.setAlarm(at),
    });
  }

  fetch(request) {
    return this.mailbox.fetch(request);
  }

  alarm() {
    return this.mailbox.alarm();
  }
}
