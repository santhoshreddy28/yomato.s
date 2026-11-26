// Staff authentication is handled by Supabase in deployed builds.
// No fallback credentials are bundled into the client.
export const STAFF = Object.freeze({});
const KEY = 'yomato.staff.';
export const staffUnlocked = portal => { try { return sessionStorage.getItem(KEY + portal) === '1'; } catch { return false; } };
export const staffLock = portal => { try { sessionStorage.removeItem(KEY + portal); } catch {} };
export function staffLogin(portal, id, password) {
  throw new Error('Staff sign-in requires the connected Supabase account.');
}
