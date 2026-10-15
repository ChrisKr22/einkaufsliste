// Maßeinheiten: Stück, Packung, Gramm, Kilogramm, Milliliter, Liter.
// Jede Einheit hat eine eigene Schrittweite für Plus/Minus und einen Startwert.

export const DEFAULT_UNIT = 'stk';

export const UNITS = {
  stk: { label: 'Stück', short: '×', step: 1, min: 1, max: 99, initial: 1 },
  pck: { label: 'Packung', short: 'Pck.', step: 1, min: 1, max: 99, initial: 1 },
  g: { label: 'Gramm', short: 'g', step: 100, min: 100, max: 10000, initial: 500 },
  kg: { label: 'Kilogramm', short: 'kg', step: 0.5, min: 0.5, max: 50, initial: 1 },
  ml: { label: 'Milliliter', short: 'ml', step: 100, min: 100, max: 10000, initial: 500 },
  l: { label: 'Liter', short: 'l', step: 0.5, min: 0.5, max: 50, initial: 1 },
};

export const UNIT_KEYS = Object.keys(UNITS);

export function unitOf(thing) {
  return UNITS[thing?.unit] ? thing.unit : DEFAULT_UNIT;
}

export function isUnit(key) {
  return Object.hasOwn(UNITS, key);
}

/** Auf die Schrittweite runden und in den erlaubten Bereich bringen. */
export function normalizeQuantity(quantity, unit = DEFAULT_UNIT) {
  const u = UNITS[unit] ?? UNITS[DEFAULT_UNIT];
  const value = Number(quantity);
  if (!Number.isFinite(value)) return u.initial;
  const stepped = Math.round(value / u.step) * u.step;
  return Math.min(u.max, Math.max(u.min, Number(stepped.toFixed(3))));
}

export function stepUp(quantity, unit) {
  const u = UNITS[unit] ?? UNITS[DEFAULT_UNIT];
  return normalizeQuantity(quantity + u.step, unit);
}

/** Eine Stufe weniger – oder null, wenn die kleinste Menge schon erreicht ist. */
export function stepDown(quantity, unit) {
  const u = UNITS[unit] ?? UNITS[DEFAULT_UNIT];
  const next = Number((quantity - u.step).toFixed(3));
  return next < u.min ? null : normalizeQuantity(next, unit);
}

const number = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 });

/** „4×“, „1,5 kg“, „500 g“, „2 Pck.“ */
export function formatQuantity(quantity, unit = DEFAULT_UNIT) {
  const u = UNITS[unit] ?? UNITS[DEFAULT_UNIT];
  return unit === DEFAULT_UNIT || !UNITS[unit] ? `${number.format(quantity)}×` : `${number.format(quantity)} ${u.short}`;
}

/** Für Screenreader: „4 Stück“, „1,5 Kilogramm“. */
export function spokenQuantity(quantity, unit = DEFAULT_UNIT) {
  const u = UNITS[unit] ?? UNITS[DEFAULT_UNIT];
  return `${number.format(quantity)} ${u.label}`;
}
