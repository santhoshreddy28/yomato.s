// Shared-backend layer (Supabase). Every function throws Error(message) on failure; the UI shows the message.
import { sb } from './supabase.js';
import { state } from './store.js';
import { SHIFTS, setShifts, setServerClock } from './shifts.js';

const fail = r => { if (r.error) throw new Error(r.error.message || 'Something went wrong'); return r.data; };
const tm = s => String(s).split(':').slice(0, 2).map(Number);
const hhmm = ([h, m]) => String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');

/* ---- auth ---- */
export const getSession = async () => (await sb.auth.getSession()).data.session;
export async function signIn(email, password) { fail(await sb.auth.signInWithPassword({ email, password })); }
/** → true when signed in straight away, false when the project requires e-mail confirmation first. */
export async function signUp({ email, password, name, phone, block, room }) {
  const d = fail(await sb.auth.signUp({ email, password, options: { data: { full_name: name, phone, block, room } } }));
  return !!d.session;
}
export const signOut = () => sb.auth.signOut();
/** Students have no login screen: each browser gets a silent anonymous session (needs "Anonymous sign-ins" switched on in Supabase). */
export async function signInGuest() { fail(await sb.auth.signInAnonymously()); }
export async function loadProfile() {
  const s = await getSession(); if (!s) return null;
  const p = fail(await sb.from('profiles').select('*').eq('id', s.user.id).single());
  return { role: p.role, name: p.full_name, phone: p.phone, block: p.block, floor: String(p.floor), room: p.room, email: s.user.email, gamePlayed: !!p.game_played };
}

/* ---- reading ---- */
const mapItem = m => ({ id: m.id, name: m.name, desc: m.description, price: Number(m.price), available: m.is_available, stock: m.stock, image: m.image });
const mapOrder = (o, otps = {}) => ({
  id: o.code, uuid: o.id, key: o.idempotency_key, createdAt: Date.parse(o.created_at),
  deliveryOtp: otps[o.id],
  shift: o.shift ? { id: o.shift, label: 'Shift ' + o.shift, delivery: SHIFTS.find(s => s.id === o.shift)?.del || '' } : null,
  customer: { name: o.customer_name, phone: o.phone, block: o.block, floor: String(o.floor), room: o.room },
  items: (o.order_items || []).map(i => ({ id: i.menu_item_id, name: i.item_name, qty: i.quantity, price: Number(i.unit_price) })),
  subtotal: Number(o.subtotal), discount: Number(o.discount), total: Number(o.total), status: o.status, agent: o.agent,
});
/** Loads menu, shift times and orders into `state`. Returns a signature so callers can tell if anything changed. */
export async function refreshData() {
  fail(await sb.rpc('sync_daily_stock'));
  const [menu, shifts, orders, booking, otpResult, gameConfigResult] = await Promise.all([
    sb.from('menu_items').select('*').order('created_at').order('name'),
    sb.from('shift_config').select('*').order('id'),
    sb.from('orders').select('*, order_items(*)').order('created_at', { ascending: false }).limit(300),
    sb.rpc('get_booking_info'),
    state.role === 'student' ? sb.rpc('get_my_delivery_otps') : Promise.resolve({ data: [], error: null }),
    sb.rpc('get_game_config'),
  ]);
  const info = fail(booking);
  setServerClock(Date.parse(info.server_now) - Date.now());
  setShifts([{ open: tm(info.open_t), close: tm(info.close_t), dStart: tm(info.deliver_start), dEnd: tm(info.deliver_end) }]);
  fail(shifts);
  state.menu = fail(menu).map(mapItem);
  const otpMap = Object.fromEntries(fail(otpResult).map(x => [x.order_id, x.otp]));
  state.orders = fail(orders).map(o => mapOrder(o, otpMap));
  state.gameConfig = fail(gameConfigResult);
  return JSON.stringify([state.menu, state.orders, state.gameConfig, SHIFTS.map(s => s.book + s.del)]);
}

/* ---- ordering ---- */
export async function startGame() { return fail(await sb.rpc('start_game')); }
export async function saveGameConfig(config) { return fail(await sb.rpc('save_game_config', { p_enabled: config.enabled, p_max_discount: config.maxDiscount, p_target_speed: config.targetSpeed })); }
export const submitGame = (id, { shots, playMs, shotData }) => sb.rpc('submit_game', { p_id: id, p_shots: shotData, p_played_ms: Math.round(playMs) }).then(fail);
export async function placeOrder({ key, items, customer, challengeId }) {
  return fail(await sb.rpc('place_order', {
    p_key: key, p_items: items.map(({ id, qty }) => ({ id, qty })),
    p_details: { name: customer.name, phone: customer.phone, block: customer.block, room: customer.room }, p_challenge: challengeId || null,
  }));
}

/* ---- orders (admin / delivery) ---- */
const uuidOf = code => state.orders.find(o => o.id === code)?.uuid;
export async function setStatus(code, status) { fail(await sb.rpc('set_order_status', { p_id: uuidOf(code), p_status: status })); }
export async function verifyDeliveryOtp(code, otp) {
  const result = fail(await sb.rpc('verify_delivery_otp', { p_id: uuidOf(code), p_otp: otp }));
  if (!result?.ok) throw new Error(result?.message || 'That OTP is incorrect.');
  return result;
}
export async function setAgent(code, agent) { fail(await sb.rpc('set_order_agent', { p_id: uuidOf(code), p_agent: agent })); }

/* ---- menu (admin) ---- */
const PHOTO_BUCKET = 'food-photos';
async function uploadPhoto(blob) {
  const path = `${crypto.randomUUID()}.jpg`;
  fail(await sb.storage.from(PHOTO_BUCKET).upload(path, blob, { contentType: 'image/jpeg', cacheControl: '31536000' }));
  return sb.storage.from(PHOTO_BUCKET).getPublicUrl(path).data.publicUrl;
}
const dropPhoto = url => { const m = String(url || '').match(new RegExp(`/${PHOTO_BUCKET}/([^/?]+)$`)); if (m) sb.storage.from(PHOTO_BUCKET).remove([m[1]]); };
/** photo: undefined = keep, null = remove, Blob = new upload */
export async function saveMenuItem(id, { name, desc, price, stock }, photo) {
  const patch = { name, description: desc, price, stock, daily_stock_limit: stock };
  const old = state.menu.find(x => x.id === id)?.image;
  if (photo !== undefined) { patch.image = photo ? await uploadPhoto(photo) : null; }
  fail(await sb.from('menu_items').update(patch).eq('id', id));
  if (photo !== undefined) dropPhoto(old);
}
export async function addMenuItem({ name, desc, price, stock }, photo) {
  const image = photo ? await uploadPhoto(photo) : null;
  fail(await sb.from('menu_items').insert({ name, description: desc, price, stock, daily_stock_limit: stock, image, is_available: false }));
}
export async function deleteMenuItem(id) {
  const old = state.menu.find(x => x.id === id)?.image;
  fail(await sb.from('menu_items').delete().eq('id', id)); dropPhoto(old);
}
export async function setTodayMeal(id) { fail(await sb.rpc('set_today_meal', { p_id: id })); }
export async function patchItem(id, patch) {
  const update = Object.hasOwn(patch, 'stock') ? { ...patch, daily_stock_limit: patch.stock } : patch;
  fail(await sb.from('menu_items').update(update).eq('id', id));
}
export async function saveShifts(list) {
  const x = list[0];
  fail(await sb.from('shift_config').update({ open_t: hhmm(x.open), close_t: hhmm(x.close), deliver_start: hhmm(x.dStart), deliver_end: hhmm(x.dEnd) }).eq('id', 1));
}
