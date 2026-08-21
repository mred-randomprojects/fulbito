/**
 * Dates, spelled out.
 *
 * `25/08/2026` is ambiguous the moment anyone from a month-first country looks
 * at it, and a bare number tells you nothing about which day of the week the
 * game is on — which is the only thing anybody actually wants to know. So
 * every date the app shows is written out with the month in words.
 */

const MONTHS = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

const WEEKDAYS = [
  "domingo",
  "lunes",
  "martes",
  "miércoles",
  "jueves",
  "viernes",
  "sábado",
];

/** Parses a yyyy-MM-dd string as a local date, not a UTC one. */
function parse(iso: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (match == null) return null;
  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "martes 25 de agosto" — the year only when it is not this one. */
export function formatMatchDate(iso: string): string {
  const date = parse(iso);
  if (date == null) return iso;
  const base = `${WEEKDAYS[date.getDay()]} ${date.getDate()} de ${MONTHS[date.getMonth()]}`;
  const thisYear = new Date().getFullYear();
  return date.getFullYear() === thisYear ? base : `${base} de ${date.getFullYear()}`;
}

/** "25 de agosto de 2026" — always with the year, for lists and share pages. */
export function formatLongDate(iso: string): string {
  const date = parse(iso);
  if (date == null) return iso;
  return `${date.getDate()} de ${MONTHS[date.getMonth()]} de ${date.getFullYear()}`;
}

/** Today as yyyy-MM-dd in local time, which `new Date().toISOString()` is not. */
export function todayIso(): string {
  const now = new Date();
  const month = `${now.getMonth() + 1}`.padStart(2, "0");
  const day = `${now.getDate()}`.padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

/** "Picado del martes" — the default name for a new match. */
export function defaultMatchName(iso: string): string {
  const date = parse(iso);
  if (date == null) return "Picado";
  return `Picado del ${WEEKDAYS[date.getDay()]}`;
}
