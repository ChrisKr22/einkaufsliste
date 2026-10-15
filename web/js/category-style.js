// Farbfläche, Symbolfarbe und Symbol je Kategorie – Platzhalter, solange ein Produkt kein Foto hat.
// Symbole: SVG-Pfade im 24×24-Raster (Strichzeichnung).

const P = {
  obst: 'M12 7.5c-2.6-1.8-7-.6-7 4.5 0 4.2 2.8 8 5 8 .9 0 1.3-.5 2-.5s1.1.5 2 .5c2.2 0 5-3.8 5-8 0-5.1-4.4-6.3-7-4.5zM12 7.5c0-2 .8-3.6 2.8-4.5',
  gemuese: 'M17 7c-2-2-5-1.5-6.5 0L3 21l13.5-7.5c1.5-1.5 2-4.5.5-6.5zM16.5 3.5L17 7l3.5.5M9 12.5l2 2M6.5 16l1.5 1.5',
  back: 'M5 11.5A3.5 3.5 0 0 1 7 5h10a3.5 3.5 0 0 1 2 6.5V19H5zM9.5 8.5l-1 3M13 8.5l-1 3M16.5 8.5l-1 3',
  fleisch: 'M14.5 3.5a5.5 5.5 0 0 1 3.9 9.4c-1.8 1.8-4.2 2.1-5.7 1.4l-3.4 3.4a2 2 0 1 1-2.3 2.3 2 2 0 1 1-1.9-3.3 2 2 0 1 1 2.3-2.3l3.4-3.4c-.7-1.5-.4-3.9 1.4-5.7a5.5 5.5 0 0 1 2.3-1.8z',
  fisch: 'M3 12c3-4.5 7.5-5.5 11.5-3L19 6v12l-4.5-3C10.5 17.5 6 16.5 3 12zM8 11.5h.01',
  milch: 'M9.5 3h5M10 3v3L8 9.5V21h8V9.5L14 6V3M8 13h8',
  kaese: 'M3 17.5L13.5 8l7.5 3.5v7.5H3zM3 17.5h18M8.5 14.5h.01M15 15.5h.01M12 12.5h.01',
  tk: 'M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9M9.5 4.5L12 6l2.5-1.5M9.5 19.5L12 18l2.5 1.5',
  nudeln: 'M12 21V8M12 8c-2-1-3-3-3-5 2 0 3 2 3 5zm0 0c2-1 3-3 3-5-2 0-3 2-3 5zM12 13c-2-1-4-2-4-4 2 0 4 1 4 4zm0 0c2-1 4-2 4-4-2 0-4 1-4 4zM12 18c-2-1-4-2-4-4 2 0 4 1 4 4zm0 0c2-1 4-2 4-4-2 0-4 1-4 4z',
  konserven: 'M6 6.5C6 5.1 8.7 4 12 4s6 1.1 6 2.5v11c0 1.4-2.7 2.5-6 2.5s-6-1.1-6-2.5zM6 6.5C6 7.9 8.7 9 12 9s6-1.1 6-2.5M6 12c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5',
  oel: 'M10.5 3h3v3L16 9.5V21H8V9.5L10.5 6zM12 11.5c-1.6 2-1.6 4.5 0 4.5s1.6-2.5 0-4.5z',
  backen: 'M4 20h16M5 20v-7h14v7M5 13c0-2 2.5-3 7-3s7 1 7 3M12 10V7M12 4.5h.01',
  snacks: 'M6 9h12l-1.5 11h-9zM7 9c-1.5-2 .5-4.5 2.8-3.2.6-2.4 4-2.4 4.4 0C16.5 4.5 18.5 7 17 9M10 12l.5 5M14 12l-.5 5',
  getraenke: 'M6 4h12l-1.6 16.5H7.6zM6.6 9.5h10.8',
  drogerie: 'M8.5 10h7v10.5h-7zM10.5 10V7h3v3M13.5 7h3M12 7V4.5',
  sonst: 'M5.5 8h13l-1 12.5h-11zM9 8V6.5a3 3 0 0 1 6 0V8',
};

const PRESETS = {
  obst: ['#F8E3E0', '#A1392F'],
  gemuese: ['#E2EDD9', '#3E6A2B'],
  back: ['#F3E7D3', '#8A5A1F'],
  fleisch: ['#F5DEDB', '#9A3B36'],
  fisch: ['#DCE8F2', '#2F5F86'],
  milch: ['#E3EAF2', '#3C5F86'],
  kaese: ['#F6EDCB', '#86651A'],
  tk: ['#DDEFF5', '#2F6A7A'],
  nudeln: ['#EFE6D6', '#7D6236'],
  konserven: ['#EDE3DA', '#7A4E33'],
  oel: ['#E8EBD2', '#5E6A1E'],
  backen: ['#F4E2EA', '#8A3F62'],
  snacks: ['#F5E6D2', '#8A5A1F'],
  getraenke: ['#DCEBEF', '#2F6A7A'],
  drogerie: ['#E6E4F2', '#4C4A86'],
  sonst: ['#E8E5E4', '#5E5759'],
};

/** @returns {{tint: string, ink: string, path: string}} */
export function categoryStyle(key) {
  const [tint, ink] = PRESETS[key] ?? PRESETS.sonst;
  return { tint, ink, path: P[key] ?? P.sonst };
}
