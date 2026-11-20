// Two daily shifts. Booking windows and delivery windows are defined here only (mirrored in supabase-schema.sql).
import { CLOUD } from './supabase.js';
// Times are the device's local clock — the hostel's phones/laptops are expected to be on IST.
const t12 = ([h, m]) => `${h % 12 || 12}:${String(m).padStart(2, '0')}`;
const ap = ([h]) => (h >= 12 ? 'PM' : 'AM');
export const fmtRange = (a, b) => `${t12(a)}${ap(a) === ap(b) ? '' : ' ' + ap(a)} – ${t12(b)} ${ap(b)}`;
const build = (id, open, close, dStart, dEnd) => ({ id, label: 'Shift ' + id, open, close, dStart, dEnd, book: fmtRange(open, close), del: fmtRange(dStart, dEnd) });
export const SHIFTS = [
  build(1, [18, 0], [19, 0], [19, 30], [20, 30]),
  build(2, [20, 30], [21, 30], [22, 0], [23, 0]),
];
/** Admin can change the times. `list` = [{open:[h,m],close:[h,m],dStart:[h,m],dEnd:[h,m]}, ...] (same length as SHIFTS). */
export function setShifts(list) {
  list.forEach((x, i) => { if (SHIFTS[i]) SHIFTS[i] = build(i + 1, x.open, x.close, x.dStart, x.dEnd); });
}
export const shiftConfig = () => SHIFTS.map(({ open, close, dStart, dEnd }) => ({ open, close, dStart, dEnd }));
// Add ?demo to the URL to test outside booking hours (the real check is server-side once a backend is connected).
export const DEMO = !CLOUD && typeof location !== 'undefined' && new URLSearchParams(location.search).has('demo');

const sec = ([h, m]) => h * 3600 + m * 60;
const nowSec = d => d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();

/** → { open: shift|null, closesIn: seconds|null, next: shift|null, opensIn: seconds|null, key } */
export function shiftState(d = new Date()) {
  const t = nowSec(d);
  const open = SHIFTS.find(s => t >= sec(s.open) && t < sec(s.close));
  if (open) return { open, closesIn: sec(open.close) - t, next: null, opensIn: null, key: 'o' + open.id };
  const next = SHIFTS.find(s => t < sec(s.open));
  if (next) return { open: null, closesIn: null, next, opensIn: sec(next.open) - t, key: 'n' + next.id };
  return { open: null, closesIn: null, next: SHIFTS[0], opensIn: 86400 - t + sec(SHIFTS[0].open), key: 'n1t' };
}
export function bookingShift(d = new Date()) { return shiftState(d).open || (DEMO ? SHIFTS[0] : null); }
export function shiftRowState(s, d = new Date()) { const t = nowSec(d); return t < sec(s.open) ? 'upcoming' : t < sec(s.close) ? 'open' : 'closed'; }
export const hms = n => [Math.floor(n / 3600), Math.floor(n / 60) % 60, n % 60].map(x => String(x).padStart(2, '0')).join(':');
