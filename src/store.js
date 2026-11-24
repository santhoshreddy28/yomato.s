import { computeDiscount, sanitizeResult } from './discount.js';
import { bookingShift, setShifts, shiftConfig } from './shifts.js';
import { CLOUD } from './supabase.js';

const KEY = 'hosteleats.v3', OLD_KEYS = ['hosteleats.v2', 'hosteleats.demo.v1'];
export const STATUSES = ['Placed', 'Accepted', 'Preparing', 'Ready for pickup', 'Out for delivery', 'Delivered', 'Cancelled'];
export const AGENTS = ['Unassigned', 'Delivery 1', 'Delivery 2', 'Delivery 3'];
const CHALLENGE_TTL = 3 * 60 * 1000;

export const seedMenu = [
  { id: 'pudina', name: 'Pudina Rice', desc: 'Fresh mint, herbs and aromatic rice', price: 70, image: 'pudina-rice.jpg' },
  { id: 'tomato', name: 'Tomato Rice', desc: 'Tangy tomato masala with rice', price: 70, image: 'tomato-rice.jpg' },
  { id: 'jeera', name: 'Jeera Rice', desc: 'Cumin, ghee and fragrant basmati', price: 70, image: 'jeera-rice.jpg' },
  { id: 'aloo', name: 'Aloo Rice', desc: 'Spiced potato tossed with rice', price: 70, image: 'aloo-rice.jpg' },
  { id: 'palak', name: 'Palak Rice', desc: 'Spinach, mild spices and rice', price: 70, image: 'palak-rice.jpg' },
  { id: 'gongura', name: 'Gongura Rice', desc: 'A bold Andhra-style tangy favourite', price: 70, image: 'gongura-rice.jpg' },
  { id: 'curd', name: 'Curd Rice', desc: 'Cooling, creamy and lightly tempered', price: 70, image: 'curd-rice.jpg' },
  { id: 'pulihora', name: 'Pulihora', desc: 'Classic tamarind rice (Tiger Rice)', price: 70, image: 'tiger-rice-pulihora.jpg' },
].map((i, n) => ({ ...i, available: n === 0, stock: null }));   // exactly one meal is served per day

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
    for (const k of OLD_KEYS) {                     // older versions: keep orders/profile, reset menu (all items now ₹70)
      const old = localStorage.getItem(k);
      if (old) { const o = JSON.parse(old); delete o.menu; return o; }
    }
  } catch { /* ignore */ }
  return {};
}
const saved = CLOUD ? { cart: load().cart } : load();   // cloud mode: menu/orders come from the server, never from this device
if (Array.isArray(saved.shifts) && saved.shifts.length) { try { setShifts(saved.shifts); } catch { /* keep defaults */ } }
const allMenu = CLOUD ? [] : (saved.menu || seedMenu).map(m => {
  const seed = seedMenu.find(s => s.id === m.id);
  return { stock: null, ...m, image: (seed && /^[a-z-]+(-cut\.webp|-3d\.webp|-photo\.webp|\.jpg|\.png)$/.test(m.image || '')) ? seed.image : (m.image || seed?.image || null) };
});
const menu = allMenu.filter(m => (m.business || 'food') === 'food');
const localDrinkExamples = [
  ['demo-lemon-juice', 'Fresh Lemon Juice', 'Fresh lemon, chilled water and a touch of sweetness', 25],
  ['demo-orange-juice', 'Orange Juice', 'Freshly squeezed seasonal oranges', 35],
  ['demo-watermelon-juice', 'Watermelon Juice', 'Chilled watermelon blended fresh', 30],
  ['demo-mango-juice', 'Mango Juice', 'Sweet mango blended to order', 35],
  ['demo-lime-soda', 'Fresh Lime Soda', 'Lime with sparkling soda, sweet or salted', 25],
  ['demo-mango-lassi', 'Mango Lassi', 'Yogurt blended with ripe mango', 40],
  ['demo-jeera-water', 'Jeera Water', 'Chilled cumin-infused water with a fresh finish', 20],
  ['demo-hot-chocolate', 'Hot Chocolate', 'Warm, rich chocolate drink', 50],
  ['demo-black-salt-lemonade', 'Black Salt Lemonade', 'Refreshing lemon drink with black salt', 25],
  ['demo-sugar-lemonade', 'Sugar Lemonade', 'Classic sweet fresh lemonade', 25],
  ['demo-oreo-shake', 'Oreo Shake', 'Creamy chocolate cookie shake', 60],
  ['demo-banana-shake', 'Banana Shake', 'Smooth banana milkshake', 50],
  ['demo-cold-coffee', 'Cold Coffee', 'Chilled creamy coffee blend', 50],
  ['demo-salt-popcorn', 'Salt Popcorn', 'Lightly salted crunchy popcorn', 35],
  ['demo-butter-popcorn', 'Butter Popcorn', 'Warm popcorn with buttery flavor', 35],
  ['demo-chilli-popcorn', 'Chilli Popcorn', 'Crunchy popcorn with a spicy chilli seasoning', 35],
].map(([id, name, desc, price]) => ({ id, name, desc, price, image: null, business: 'drinks', available: true, stock: 20 }));
const drinksMenu = allMenu.filter(m => m.business === 'drinks');
if (!CLOUD && !saved.drinksSeeded) drinksMenu.push(...localDrinkExamples);
const localGameCycleKey = () => `${new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())}|${JSON.stringify(shiftConfig())}`;
const initialGameCycleKey = localGameCycleKey();
const savedGameMin = Math.max(0, Math.floor(Number(saved.gameConfig?.minDiscount ?? 4) || 0));
const savedGameMax = Math.max(savedGameMin, Math.floor(Number(saved.gameConfig?.maxDiscount ?? 9) || 0));

// Only one meal may be live; normalise older saved data.
let live = false;
for (const m of menu) { if (m.available) { if (live) m.available = false; live = true; } }

export const state = {
  role: 'student', page: 'menu', menuTab: 'all', query: '', business: 'food', drinksConfig: saved.drinksConfig || { enabled: !CLOUD, nextOpenAt: CLOUD ? null : Date.now() + 37 * 3600 * 1000 }, drinksLaunchAt: saved.drinksLaunchAt || (CLOUD ? null : Date.now() + 37 * 3600 * 1000), ordersTab: 'food',
  menu, drinksMenu, orders: saved.orders || [], cart: saved.cart || {},
  profile: saved.profile || { name: '', phone: '', block: 'A', floor: '1', room: '' },
  challenges: saved.challenges || {},
  gamePlayed: saved.gameCycleKey ? saved.gameCycleKey === initialGameCycleKey && !!saved.gamePlayed : !!saved.gamePlayed || Object.keys(saved.challenges || {}).length > 0,
  gameCycleKey: initialGameCycleKey,
  gameConfig: saved.gameConfig ? { ...saved.gameConfig, minDiscount: savedGameMin, maxDiscount: savedGameMax } : { enabled: true, minDiscount: 4, maxDiscount: 9, targetSpeed: 2.4 },
  pendingGameReward: null,
  checkout: null,        // delivery details of the order being placed
  checkoutKey: null,     // idempotency key for the order being placed
  challengeId: null,     // game challenge for the order being placed
  placing: false,
};

const snapshot = () => JSON.stringify(CLOUD ? { cart: state.cart } : { menu: [...state.menu.map(x => ({ ...x, business: 'food' })), ...state.drinksMenu.map(x => ({ ...x, business: 'drinks' }))], drinksSeeded: true, drinksLaunchAt: state.drinksLaunchAt, orders: state.orders, cart: state.cart, profile: state.profile, challenges: state.challenges, gamePlayed: state.gamePlayed, gameCycleKey: localGameCycleKey(), gameConfig: state.gameConfig, shifts: shiftConfig() });
let persistTimer = 0;
export function persist() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    try {
      localStorage.setItem(KEY, snapshot());
    } catch { /* storage full/blocked: app keeps working in memory */ }
  }, 60);
}
window.addEventListener('pagehide', () => { clearTimeout(persistTimer); try { localStorage.setItem(KEY, snapshot()); } catch {} });

export const money = n => '₹' + Number(n || 0).toFixed(0);
export const findMenuItem = id => [...state.menu, ...state.drinksMenu].find(x => x.id === id);
export const cartEntries = () => Object.entries(state.cart).map(([id, qty]) => ({ item: findMenuItem(id), qty })).filter(x => x.item && x.qty > 0);
export const cartCount = () => cartEntries().reduce((a, x) => a + x.qty, 0);
export const subtotal = () => cartEntries().reduce((a, x) => a + x.item.price * x.qty, 0);
export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));

export function maxQty(item) { return item.stock == null ? 99 : Math.max(0, item.stock); }
export function isAvailable(item) { return item.available && (item.stock == null || item.stock > 0); }

// ---- Game challenge ledger (trusted side) -------------------------------------------------------------
export function issueChallenge() {
  if (state.gamePlayed || !state.gameConfig.enabled) throw new Error(state.gamePlayed ? 'You have already used your game chance.' : 'The game is temporarily unavailable.');
  const now = Date.now();
  for (const [k, c] of Object.entries(state.challenges)) if (now - c.issuedAt > 24 * 3600e3) delete state.challenges[k];
  const id = uid();
  state.challenges[id] = { id, issuedAt: now, expiresAt: now + CHALLENGE_TTL, result: null, used: false, minDiscount: state.gameConfig.minDiscount, maxDiscount: state.gameConfig.maxDiscount };
  state.challengeId = id;
  state.gamePlayed = true;
  persist();
  return id;
}
/** Record the game outcome once. Returns the discount the student has earned for the *current* cart. */
export function submitGameResult(id, raw) {
  const c = state.challenges[id];
  if (!c || c.used || c.result || Date.now() > c.expiresAt) return 0;
  c.result = sanitizeResult(raw);
  persist();
  return previewDiscount(id);
}
export function previewDiscount(id) {
  const c = state.challenges[id];
  if (!c || c.used || !c.result) return 0;
  return computeDiscount({ subtotal: subtotal(), ...c.result, minDiscount: c.minDiscount ?? state.gameConfig.minDiscount, maxDiscount: c.maxDiscount ?? state.gameConfig.maxDiscount });
}

// ---- Orders ---------------------------------------------------------------------------------------------
/** Creates the order. Idempotent on `key`: a repeat call returns the already-created order. */
export function placeOrder({ key, customer, challengeId }) {
  const existing = state.orders.find(o => o.key === key);
  if (existing) return { ok: true, order: existing, duplicate: true };
  const entries = cartEntries();
  if (!entries.length) return { ok: false, error: 'Your cart is empty' };
  const shift = bookingShift();
  if (!shift) return { ok: false, error: 'Booking is closed right now' };
  for (const { item, qty } of entries) {
    if (!item.available) return { ok: false, error: `${item.name} is no longer available` };
    if (item.stock != null && qty > item.stock) return { ok: false, error: `Only ${item.stock} left of ${item.name}` };
  }
  const sub = subtotal();
  const discount = challengeId ? (state.pendingGameReward?.id === challengeId && state.pendingGameReward.discount != null ? Math.min(sub, state.pendingGameReward.discount) : previewDiscount(challengeId)) : 0;   // never taken from the client
  if (challengeId && state.challenges[challengeId]) state.challenges[challengeId].used = true;
  const order = {
    id: 'AN-' + String(Date.now()).slice(-6), key, business: state.business || 'food', shift: { id: shift.id, label: shift.label, delivery: shift.del }, createdAt: Date.now(), customer, gameChallengeId: challengeId || null,
    items: entries.map(({ item, qty }) => ({ id: item.id, name: item.name, qty, price: item.price })),
    subtotal: sub, discount, total: Math.max(0, sub - discount), status: 'Placed', agent: 'Unassigned',
  };
  for (const { item, qty } of entries) if (item.stock != null) item.stock -= qty;
  state.orders.unshift(order);
  state.cart = {}; state.profile = customer; state.challengeId = null; state.pendingGameReward = null; state.checkoutKey = null;
  persist();
  return { ok: true, order };
}

export function updateOrder(id, patch) {
  const o = state.orders.find(x => x.id === id);
  if (!o || o.status === 'Cancelled') return;   // cancelled orders are final (stock already restored)
  if (patch.status === 'Cancelled' && o.status !== 'Cancelled') {
    for (const i of o.items) { const m = findMenuItem(i.id); if (m && m.stock != null) m.stock += i.qty; }
    const challenge = o.gameChallengeId && state.challenges[o.gameChallengeId];
    if (challenge?.result) { challenge.used = false; state.pendingGameReward = { id: challenge.id, ...challenge.result, minDiscount: challenge.minDiscount ?? state.gameConfig.minDiscount, maxDiscount: challenge.maxDiscount ?? state.gameConfig.maxDiscount, discount: o.discount }; }
  }
  Object.assign(o, patch);
  persist();
}

// ---- Admin: menu management -----------------------------------------------------------------------------
export function saveItem(id, patch) {
  const m = findMenuItem(id); if (!m) return null;
  Object.assign(m, patch);
  if (state.cart[id] && m.stock != null && state.cart[id] > m.stock) { m.stock ? state.cart[id] = m.stock : delete state.cart[id]; }
  persist(); return m;
}
export function addItem(data) {
  const m = { id: 'custom-' + uid(), available: false, business: state.business || 'food', ...data };
  (m.business === 'drinks' ? state.drinksMenu : state.menu).push(m); persist(); return m;
}
export function removeItem(id) {
  state.menu = state.menu.filter(x => x.id !== id); state.drinksMenu = state.drinksMenu.filter(x => x.id !== id); delete state.cart[id]; persist();
}
export function syncGameCycle() {
  const key = localGameCycleKey();
  if (key === state.gameCycleKey) return false;
  state.gameCycleKey = key; state.gamePlayed = false; persist(); return true;
}
export function updateShifts(list) { setShifts(list); syncGameCycle(); persist(); }
