// One daily booking shift. Booking and delivery windows are defined here only.
import { CLOUD } from './supabase.js';
// Times are the device's local clock — the hostel's phones/laptops are expected to be on IST.
const t12 = ([h, m]) => `${h % 12 || 12}:${String(m).padStart(2, '0')}`;
const ap = ([h]) => (h >= 12 ? 'PM' : 'AM');
export const fmtRange = (a, b) => `${t12(a)}${ap(a) === ap(b) ? '' : ' ' + ap(a)} – ${t12(b)} ${ap(b)}`;
const build = (id, open, close, dStart, dEnd) => ({ id, label: 'Shift ' + id, open, close, dStart, dEnd, book: fmtRange(open, close), del: fmtRange(dStart, dEnd) });
export const SHIFTS = [build(1, [18, 0], [19, 0], [19, 30], [20, 30])];
/** Admin can change the single daily shift. */
export function setShifts(list) {
  if (list[0]) SHIFTS[0] = build(1, list[0].open, list[0].close, list[0].dStart, list[0].dEnd);
}
export const shiftConfig = () => SHIFTS.map(({ open, close, dStart, dEnd }) => ({ open, close, dStart, dEnd }));
// Add ?demo to the URL to test outside booking hours (the real check is server-side once a backend is connected).
export const DEMO = !CLOUD && typeof location !== 'undefined' && new URLSearchParams(location.search).has('demo');

const sec = ([h, m]) => h * 3600 + m * 60;
const nowSec = d => {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(d);
  const n = Object.fromEntries(p.map(x => [x.type, Number(x.value)]));
  return n.hour * 3600 + n.minute * 60 + n.second;
};
let serverOffsetMs = 0;
export const setServerClock = offsetMs => { if (Number.isFinite(offsetMs)) serverOffsetMs = offsetMs; };

/** → { open: shift|null, closesIn: seconds|null, next: shift|null, opensIn: seconds|null, key } */
export function shiftState(d = new Date(Date.now() + serverOffsetMs)) {
  const t = nowSec(d);
  const s = SHIFTS[0], opening = sec(s.open), closing = sec(s.close);
  const overnight = closing < opening;
  const isOpen = closing !== opening && (overnight ? t >= opening || t < closing : t >= opening && t < closing);
  if (isOpen) return { open: s, closesIn: overnight && t >= opening ? closing + 86400 - t : closing - t, next: null, opensIn: null, key: 'o1' };
  const opensIn = t < opening ? opening - t : 86400 - t + opening;
  return { open: null, closesIn: null, next: s, opensIn, key: t < opening ? 'n1' : 'n1t' };
}
export function bookingShift(d = new Date(Date.now() + serverOffsetMs)) { return shiftState(d).open || (DEMO ? SHIFTS[0] : null); }
export function nextBookingIn(d = new Date(Date.now() + serverOffsetMs)) {
  const current = shiftState(d);
  if (!current.open) return current.opensIn;
  return 86400 - nowSec(d) + sec(SHIFTS[0].open);
}
export function shiftRowState(s, d = new Date(Date.now() + serverOffsetMs)) { const t = nowSec(d), a = sec(s.open), b = sec(s.close); return b < a ? (t >= a || t < b ? 'open' : 'upcoming') : (t < a ? 'upcoming' : t < b ? 'open' : 'closed'); }
export const hms = n => [Math.floor(n / 3600), Math.floor(n / 60) % 60, n % 60].map(x => String(x).padStart(2, '0')).join(':');
