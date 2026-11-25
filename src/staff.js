// Staff logins for the two private endpoints when the app runs WITHOUT a Supabase backend (local / demo mode).
//   /A1121/  → admin      /1121/  → delivery
// This is only a screen lock for demos: the values ship inside the page, so anyone can read them.
// With Supabase connected (see README) real accounts + row-level security are used instead and this file is ignored.
// Change the passwords before you share a demo link.
export const STAFF = {
  admin: { id: 'A1121', password: 'Yomato@A1121', email: 'admin@yomato.in' },
  delivery: { id: '1121', password: 'Yomato@1121', email: 'delivery@yomato.in' },
};
const KEY = 'yomato.staff.';
export const staffUnlocked = portal => { try { return sessionStorage.getItem(KEY + portal) === '1'; } catch { return false; } };
export const staffLock = portal => { try { sessionStorage.removeItem(KEY + portal); } catch {} };
export function staffLogin(portal, id, password) {
  const s = STAFF[portal];
  if (!s || ![s.id, s.email].map(x => x.toLowerCase()).includes(id.trim().toLowerCase()) || password !== s.password) throw new Error('Wrong ID or password.');
  try { sessionStorage.setItem(KEY + portal, '1'); } catch {}
}
