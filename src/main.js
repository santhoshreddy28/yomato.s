import { state, STATUSES, AGENTS, money, cartEntries, cartCount, subtotal, uid, persist, maxQty, findMenuItem, issueChallenge, submitGameResult, previewDiscount, placeOrder, updateOrder, saveItem, addItem, removeItem, updateShifts, syncGameCycle } from './store.js';
import '@fontsource-variable/fraunces';
import '@fontsource-variable/dm-sans';
import { mountGame } from './game.js';
import { SHIFTS, DEMO, shiftState, bookingShift, nextBookingIn, hms } from './shifts.js';
import { arrowRewardsForScores, computeDiscount } from './discount.js';
import { CLOUD, sb } from './supabase.js';
import * as cloud from './cloud.js';
import { staffUnlocked, staffLock, staffLogin } from './staff.js';

const app = document.querySelector('#app');
/** Student, food staff, and drinks staff each use distinct portal paths. */
const PORTAL = ['admin', 'delivery', 'drinks-admin', 'drinks-delivery'].includes(window.ANNAM_PORTAL) ? window.ANNAM_PORTAL : 'student';
const PORTAL_ROLE = PORTAL === 'drinks-admin' ? 'admin' : PORTAL === 'drinks-delivery' ? 'delivery' : PORTAL;
const BUSINESS = PORTAL.startsWith('drinks-') ? 'drinks' : 'food';
const ROOT = PORTAL === 'student' ? './' : '../';
const APP_VERSION = '1.1.0';
// Staff endpoints:  /1121/ (delivery)   /A1121/ (admin)
const PORTAL_URL = { student: ROOT, admin: ROOT + 'A1121/', delivery: ROOT + '1121/', 'drinks-admin': ROOT + 'A1026/', 'drinks-delivery': ROOT + '1026/' };
const IMG_BASE = ROOT + 'images/foods/';
const money2 = n => '₹' + Number(n || 0).toFixed(2);
const esc = (s = '') => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ICON = {
  download: '<path d="M12 4v11"/><path d="M7 11l5 5 5-5"/><path d="M5 20h14"/>', menu: '<path d="M4 6h16M4 12h16M4 18h10"/>', orders: '<path d="M7 4h10a1 1 0 0 1 1 1v15l-3-2-3 2-3-2-3 2V5a1 1 0 0 1 1-1z"/><path d="M9 9h6M9 13h4"/>',
  user: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c0-3.6 3.1-6 7-6s7 2.4 7 6"/>', cart: '<path d="M4 5h2l2 10h9l2-7H7"/><circle cx="10" cy="19" r="1.2"/><circle cx="17" cy="19" r="1.2"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
  bike: '<circle cx="6" cy="16" r="3"/><circle cx="18" cy="16" r="3"/><path d="M6 16l4-8h5l3 8M10 8H8"/>', clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4-4"/>', back: '<path d="M15 5l-7 7 7 7"/>', close: '<path d="M6 6l12 12M18 6L6 18"/>', edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>', trash: '<path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/>', image: '<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><circle cx="9" cy="10" r="1.6"/><path d="M4 17l5-4.5 4 3.5 3-2.5 4 3.5"/>', bolt: '<path d="M13 3L5 13h6l-1 8 8-10h-6z"/>', truck: '<path d="M3 7h11v9H3zM14 10h4l3 3v3h-7"/><circle cx="7" cy="17.5" r="1.6"/><circle cx="17" cy="17.5" r="1.6"/>',
};
const ico = n => `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[n]}</svg>`;

/* ---------------- navigation ---------------- */
const NAV = {
  student: [['menu', 'Food', 'menu'], ['drinks', 'Fresh juice', 'menu'], ['orders', 'My orders', 'orders']],
  admin: [['overview', 'Dashboard', 'grid'], ['orders', 'Orders', 'orders'], ['menu-admin', 'Menu', 'menu'], ['shifts-admin', 'Shifts', 'clock'], ['game-admin', 'Game', 'bolt']],
  'drinks-admin': [['overview', 'Dashboard', 'grid'], ['orders', 'Orders', 'orders'], ['menu-admin', 'Fresh juice', 'menu'], ['drinks-settings', 'Juice access', 'clock'], ['game-admin', 'Game', 'bolt']],
  delivery: [['active-deliveries', 'Active', 'bike'], ['delivery-history', 'Completed', 'clock']],
};
const navItems = () => NAV[PORTAL] || NAV[state.role];
// The Student/Admin/Delivery preview switch exists only for local demo use (npm run dev, or add ?demo to the address). Students never see it.
const HOME = { student: 'menu', admin: 'overview', delivery: 'active-deliveries', 'drinks-admin': 'overview', 'drinks-delivery': 'active-deliveries' };
state.business = BUSINESS;
state.role = PORTAL_ROLE; state.page = HOME[PORTAL];   // each endpoint is locked to its own portal

/* ---- direct APK download (file lives at downloads/yomato.apk; button only appears once the file exists) ---- */
const APK_URL = ROOT + 'downloads/yomato.apk';
const installed = matchMedia('(display-mode: standalone)').matches || !!window.Capacitor?.isNativePlatform?.() || /iPhone|iPad|iPod/i.test(navigator.userAgent);
let apkInfo = null;
const installButton = () => apkInfo ? `<a class="install-btn" href="${APK_URL}" download="Yomato.apk" data-apk aria-label="Download the Yomato Android app"><span class="ib-ico">${ico('download')}</span><span class="ib-txt"><b>Get the app</b><small>Android${apkInfo.size ? ' · ' + Math.round(apkInfo.size / 1048576 * 10) / 10 + ' MB' : ''}</small></span></a>` : '';
if (!installed) fetch(APK_URL, { method: 'HEAD', cache: 'no-store' }).then(r => {
  if (!r.ok || /text\/html/.test(r.headers.get('content-type') || '')) return;
  apkInfo = { size: Number(r.headers.get('content-length')) || 0 };
  if (document.querySelector('.topbar')) render();
}).catch(() => {});
document.addEventListener('click', e => { if (e.target.closest?.('[data-apk]')) showToast(`Yomato APK v${APP_VERSION} · Downloading now. Open the file when it finishes.`, 5000); });

function brand() { return `<div class="brand" aria-label="Yomato"><span class="brand-word"><b class="bw-yo">yo</b><span class="bw-mato">mato</span></span></div>`; }
function header() {
  return `<header class="topbar">${brand()}
  <nav class="top-links">${navItems().map(([id, label]) => `<button class="nav-btn ${state.page === id ? 'active' : ''}" data-action="nav" data-page="${id}">${label}</button>`).join('')}</nav>
  <div class="top-actions">${installButton()}${!CLOUD && PORTAL !== 'student' ? `<span class="who">${state.role === 'admin' ? 'Admin' : 'Delivery'}</span><button class="signout" data-action="signout">Sign out</button>` : ''}${CLOUD && PORTAL !== 'student' ? `<span class="who">${esc(state.role === 'student' ? (state.profile.name || '').split(' ')[0] : state.role[0].toUpperCase() + state.role.slice(1))}</span><button class="signout" data-action="signout">Sign out</button>` : ''}
</div></header>`;
}
function mobileNav() {
  const items = navItems().map(([id, label, ic]) => `<button class="${state.page === id ? 'active' : ''}" data-action="nav" data-page="${id}">${ico(ic)}<span>${label}</span></button>`);
  return `<nav class="mobile-nav" style="--n:${items.length}">${items.join('')}</nav>`;
}
function pageHead(title, sub = '', right = '') { return `<div class="page-head"><div><h1>${title}</h1>${sub ? `<p>${sub}</p>` : ''}</div>${right}</div>`; }
const empty = msg => `<div class="empty-state">${msg}</div>`;
const activeMenu = () => state.business === 'drinks' ? state.drinksMenu : state.menu;
const activeOrders = () => state.orders.filter(o => (o.business || 'food') === state.business);

/* ---------------- student ---------------- */
const imgSrc = im => (/^(data:|https?:|blob:)/.test(im) ? im : IMG_BASE + im);
function photo(item) {
  return item.image
    ? `<img src="${esc(imgSrc(item.image))}" alt="${esc(item.name)}" decoding="async" fetchpriority="high">`
    : `<span class="ph">${esc(item.name[0])}</span>`;
}
const todayItem = () => state.menu.find(item => item.available);
function counterHTML(nextOnly = false) {
  const st = shiftState(), s = st.open || st.next;
  return `<div class="status-card ${st.open && !nextOnly ? 'live' : ''}"><div><span class="k">${st.open && !nextOnly ? 'Reservations close in' : 'Reservations open in'}</span><b id="counter" data-mode="${nextOnly ? 'next' : 'shift'}">${hms(nextOnly ? nextBookingIn() : st.open ? st.closesIn : st.opensIn)}</b></div>
  <i class="sep"></i><div><span class="k">Delivered between</span><b class="t">${s.del}</b></div></div>`;
}
function orderBox(item) {
  const qty = state.cart[item.id] || 1, can = !!bookingShift();
  const shift = shiftState(), completed = !shift.open && shift.key === 'n1t' && !DEMO;
  const closedMessage = completed ? `<p class="booking-complete" role="status">Today’s booking is completed. Please check back during the next shift.</p>` : '';
  const gamePromo = state.gameConfig.enabled && !state.gamePlayed
    ? `<p class="game-promo-note">Play the game for a chance to get up to ${money(state.gameConfig.maxDiscount)} off!</p>` : '';
  return `${counterHTML()}<div class="today-row"><div class="price-wrap"><span class="price">${money(item.price * qty)}</span><small>${qty > 1 ? qty + ' plates' : 'One plate'}</small></div><div class="qty-control"><button data-action="qty" data-id="${item.id}" data-delta="-1" aria-label="One less" ${qty <= 1 ? 'disabled' : ''}>−</button><span>${qty}</span><button data-action="qty" data-id="${item.id}" data-delta="1" aria-label="One more" ${qty >= maxQty(item) ? 'disabled' : ''}>+</button></div></div>
  ${closedMessage}<button class="primary-btn full big" data-action="checkout" ${can ? '' : 'disabled'}>${can ? 'Reserve this meal' : completed ? 'Booking completed' : 'Reservations closed'}</button>${gamePromo}`;
}
// Live counter: ticks every second; the section re-renders only when a booking window opens or closes.
let lastShiftKey = shiftState().key;
setInterval(() => {
  if (!CLOUD && syncGameCycle()) { lastShiftKey = shiftState().key; if (state.page === 'menu') refreshCart(); else render(); }
  const drinkCounter = document.getElementById('drinks-counter');
  if (drinkCounter && state.drinksLaunchAt) {
    const remaining = Math.max(0, Math.ceil((new Date(state.drinksLaunchAt).getTime() - Date.now()) / 1000));
    drinkCounter.textContent = hms(remaining);
    if (!remaining) render();
  }
  const el = document.getElementById('counter'); if (!el) return;
  const st = shiftState();
  if (st.key !== lastShiftKey) { lastShiftKey = st.key; refreshCart(); return; }
  el.textContent = hms(el.dataset.mode === 'next' ? nextBookingIn() : st.open ? st.closesIn : st.opensIn);
}, 1000);
function menuPage() {
  const item = todayItem();
  if (!item) return `<section class="today closed"><div class="today-body"><p class="eyebrow"><span>Today</span></p><h1>We’re updating today’s menu.</h1><p class="desc">Please check back soon while we prepare the menu.</p><p class="audience-note">Available only for BS-13 residents.</p></div></section>`;
  if (item.stock === 0) return `<section class="today closed sold-out"><div class="today-body"><p class="eyebrow"><span>Today · Fully booked</span></p><h1>All available plates have been booked.</h1><p class="desc">Thank you for your interest. The next booking window opens in:</p>${counterHTML(true)}</div></section>`;
  state.cart = { [item.id]: Math.min(state.cart[item.id] || 1, maxQty(item)) || 1 };
  const day = new Date().toLocaleDateString(undefined, { weekday: 'long' });
  return `<section class="today"><div class="today-art"><div class="arch"><div class="arch-in">${photo(item)}</div></div></div>
  <div class="today-body"><p class="eyebrow"><span>Today’s meal · ${day}</span></p><h1>${esc(item.name)}</h1><p class="desc">${esc(item.desc)}</p><p class="audience-note">Available only for BS-13 residents.</p><div class="orn" aria-hidden="true"><i></i></div>
  <div id="order-box">${item.stock != null && item.stock <= 5 ? `<div class="stock-warning" role="status">ONLY ${item.stock} LEFT</div>` : ''}${orderBox(item)}</div></div></section>`;
}
function drinksPage() {
  const config = state.drinksConfig || { enabled: false, nextOpenAt: state.drinksLaunchAt };
  const launchAt = config.nextOpenAt ? new Date(config.nextOpenAt).getTime() : Date.now() + 37 * 3600 * 1000;
  const remaining = config.enabled ? 0 : Math.max(0, Math.ceil((launchAt - Date.now()) / 1000));
  if (remaining) return `<section class="today drinks-coming-soon"><div class="today-body"><p class="eyebrow"><span>Fresh juice</span></p><h1>Fresh juice will be available soon.</h1><p class="desc">We’re getting everything ready for you.</p><p class="audience-note">Available only for BS-13 residents.</p><div class="drinks-countdown"><span>Available in</span><strong id="drinks-counter">${hms(remaining)}</strong></div></div></section>`;
  const items = state.drinksMenu.filter(item => item.available && (item.stock == null || item.stock > 0));
  const gamePromo = `<p class="audience-note">Available only for BS-13 residents.</p>${state.gameConfig.enabled && !state.gamePlayed ? `<p class="game-promo-note">Play the game for a chance to get up to ${money(state.gameConfig.maxDiscount)} off!</p>` : ''}`;
  return `<section class="today drinks-menu"><div class="today-body"><p class="eyebrow"><span>Fresh juice · Today</span></p><h1>Fresh juice</h1><p class="desc">Freshly prepared juice, delivered to your room.</p>${items.length ? `<div class="drinks-grid">${items.map(item => `<article class="drink-card"><div class="drink-photo">${photo(item)}</div><div class="drink-card-info"><h2>${esc(item.name)}</h2><p>${esc(item.desc || '')}</p><div class="drink-card-foot"><strong>${money(item.price)}</strong><div class="qty-control"><button data-action="qty" data-id="${esc(item.id)}" data-delta="-1" aria-label="One less" ${!state.cart[item.id] ? 'disabled' : ''}>−</button><span>${state.cart[item.id] || 0}</span><button data-action="qty" data-id="${esc(item.id)}" data-delta="1" aria-label="One more" ${state.cart[item.id] >= maxQty(item) ? 'disabled' : ''}>+</button></div></div></div></article>`).join('')}</div><button class="primary-btn full big drinks-reserve" data-action="checkout" ${cartCount() ? '' : 'disabled'}>Book juice${cartCount() ? ` · ${cartCount()} item${cartCount() === 1 ? '' : 's'}` : ''}</button>${gamePromo}` : empty('We’re updating today’s fresh juice menu. Please check back soon.')}</div></section>`;
}
function orderCard(o, allowCancel = false) {
  return `<div class="order-card"><div class="order-head"><span class="order-id">Ref. ${esc(o.id)}</span><span class="status ${statusClass(o.status)}">${esc(o.status)}</span></div>
  <div class="order-items">${o.items.map(i => `${i.qty} × ${esc(i.name)}`).join(' · ')}</div>
  ${o.shift ? `<div class="order-shift">Delivery between <b>${esc(o.shift.delivery)}</b></div>` : ''}
  ${o.deliveryOtp ? `<div class="order-otp">Delivery OTP <strong>${esc(o.deliveryOtp)}</strong></div>` : ''}
  <div class="order-meta"><span>Block ${esc(o.customer.block)} · Room ${esc(o.customer.room)}</span><span>${new Date(o.createdAt).toLocaleString()}</span>
  <strong>${o.discount ? `<s>${money(o.subtotal)}</s> ` : ''}${money(o.total)}</strong></div>${allowCancel && ['Placed', 'Accepted', 'Preparing', 'Ready for pickup'].includes(o.status) ? `<button class="cancel-order-btn" data-action="cancel-order" data-id="${esc(o.id)}">Cancel order</button>` : ''}</div>`;
}
const STEP = { Placed: 0, Accepted: 0, Preparing: 1, 'Ready for pickup': 1, 'Out for delivery': 2, Delivered: 3 };
function tracker(o) {
  if (o.status === 'Cancelled') return '';
  const at = STEP[o.status] ?? 0;
  return `<ol class="tracker">${['Received', 'Preparing', 'On the way', 'Delivered'].map((l, i) => `<li class="${i < at ? 'done' : i === at ? 'now' : ''}"><i></i><span>${l}</span></li>`).join('')}</ol>`;
}
function studentOrders() {
  const mine = CLOUD ? state.orders : state.orders.filter(o => !state.profile.phone || o.customer.phone === state.profile.phone);
  return `<div class="wrap">${pageHead('My orders', 'Your meals and fresh juice, from our kitchen to your door.')}${mine.length ? mine.map(o => orderCard(o, true).replace(/<\/div>$/, tracker(o) + '</div>')).join('') : empty('Your reservations will appear here.')}</div>`;
}
function fields(p) {
  return `<div class="field full-width"><label>Full name</label><input name="name" value="${esc(p.name)}" placeholder="Your name" autocomplete="name" required></div>
  <div class="field full-width"><label>Mobile number</label><input name="phone" value="${esc(p.phone)}" inputmode="numeric" pattern="[0-9]{10}" maxlength="10" placeholder="10-digit mobile number" autocomplete="tel" required></div>
  <div class="field"><label>Block</label><select name="block"><option value="A" ${p.block === 'A' ? 'selected' : ''}>Block A</option><option value="B" ${p.block === 'B' ? 'selected' : ''}>Block B</option></select></div>
  <div class="field"><label>Room number</label><input name="room" value="${esc(p.room)}" inputmode="numeric" pattern="[0-9]{3,4}" maxlength="4" placeholder="Enter your room number" required></div>`;
}
/** Room 612 → floor 6, 1012 → floor 10, 1121 → floor 11. */
const floorOf = room => Math.floor((parseInt(String(room).replace(/\D/g, ''), 10) || 0) / 100);
const statusClass = s => ({ 'Delivered': 'delivered', 'Ready for pickup': 'ready', 'Out for delivery': 'ready', 'Preparing': 'preparing', 'Cancelled': 'cancelled' }[s] || '');

/* ---------------- admin ---------------- */
function adminOverview() {
  const orders = activeOrders(), live = orders.filter(o => o.status !== 'Cancelled');
  const active = live.filter(o => o.status !== 'Delivered'), done = live.filter(o => o.status === 'Delivered');
  const revenue = done.reduce((a, o) => a + o.total, 0), avg = live.length ? live.reduce((a, o) => a + o.total, 0) / live.length : 0;
  const tally = {}; live.forEach(o => o.items.forEach(i => tally[i.name] = (tally[i.name] || 0) + i.qty));
  const top = Object.entries(tally).sort((a, b) => b[1] - a[1]).slice(0, 5), topMax = top[0]?.[1] || 1;
  const blocks = ['A', 'B'].map(b => [b, live.filter(o => o.customer.block === b).length]);
  return `${pageHead(state.business === 'drinks' ? 'Drinks dashboard' : 'Dashboard', state.business === 'drinks' ? 'Today’s drinks operations' : 'Today’s hostel food operations')}
  <div class="stat-grid">${[['Total orders', live.length], ['Active', active.length], ['Delivered', done.length], ['Delivered revenue', money(revenue)], ['Avg. order', money(avg)]].map(([l, v]) => `<div class="stat"><div class="label">${l}</div><div class="value">${v}</div></div>`).join('')}</div>
  <div class="two-col"><div class="panel"><h3>Top items</h3>${top.length ? top.map(([n, q]) => `<div class="bar-row"><span>${esc(n)}</span><div class="bar"><i style="width:${q / topMax * 100}%"></i></div><b>${q}</b></div>`).join('') : '<p class="muted small">No sales yet.</p>'}</div>
  <div class="panel"><h3>Orders by block</h3>${blocks.map(([b, n]) => `<div class="bar-row"><span>Block ${b}</span><div class="bar"><i style="width:${live.length ? n / live.length * 100 : 0}%"></i></div><b>${n}</b></div>`).join('')}</div></div>
  <div class="section-heading"><h2>Recent orders</h2><button class="link-btn" data-action="nav" data-page="orders">Manage orders →</button></div>
  ${orders.length ? orders.slice(0, 5).map(orderCard).join('') : empty('New student orders will appear here.')}`;
}
let adminFilter = 'all';
function adminOrders() {
  const list = activeOrders().filter(o => adminFilter === 'all' || (adminFilter === 'active' ? !['Delivered', 'Cancelled'].includes(o.status) : o.status === 'Delivered'));
  const tabs = [['all', 'All'], ['active', 'Active'], ['done', 'Delivered']];
  return `${pageHead(state.business === 'drinks' ? 'Drinks orders' : 'Orders', 'Update status and assign delivery agents')}
  <div class="tabs">${tabs.map(([v, t]) => `<button class="tab ${adminFilter === v ? 'active' : ''}" data-action="admin-filter" data-filter="${v}">${t}</button>`).join('')}</div>
  ${list.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Order</th><th>Student</th><th>Location</th><th>Items</th><th>Total</th><th>Status</th><th>Agent</th></tr></thead><tbody>${list.map(o => `<tr>
    <td><strong>${esc(o.id)}</strong><br><span class="muted">${new Date(o.createdAt).toLocaleTimeString()}</span></td>
    <td>${esc(o.customer.name)}<br><span class="muted">${esc(o.customer.phone)}</span></td>
    <td>${esc(o.customer.block)} · ${esc(o.customer.floor)}F · ${esc(o.customer.room)}${o.shift ? `<br><span class="muted">${esc(o.shift.label)}</span>` : ''}</td>
    <td>${o.items.map(i => `${i.qty}× ${esc(i.name)}`).join('<br>')}</td>
    <td>${money(o.total)}${o.discount ? `<br><span class="muted">−${money(o.discount)}</span>` : ''}</td>
    <td><select class="select-small" data-order-status="${o.id}" ${['Cancelled', 'Delivered'].includes(o.status) ? 'disabled' : ''}>${STATUSES.filter(s => s !== 'Delivered' || o.status === 'Delivered').map(s => `<option ${o.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></td>
    <td><select class="select-small" data-agent="${o.id}">${AGENTS.map(a => `<option ${o.agent === a ? 'selected' : ''}>${a}</option>`).join('')}</select></td></tr>`).join('')}</tbody></table></div>` : empty('No orders to show.')}`;
}
function adminMenu() {
  const items = activeMenu(), itemLabel = state.business === 'drinks' ? 'drink' : 'food item';
  return `${pageHead(state.business === 'drinks' ? 'Drinks menu' : 'Menu', state.business === 'drinks' ? 'Add and manage today’s drink options' : 'Edit photos, prices, stock — and choose the one meal served today', `<button class="primary-btn" data-action="add-food">+ Add ${itemLabel}</button>`)}
  <div class="table-wrap"><table class="data-table menu-table"><thead><tr><th>${state.business === 'drinks' ? 'Drink' : 'Dish'}</th><th>Price</th><th>Stock</th><th>Available today</th><th></th></tr></thead><tbody>${items.map(item => `<tr>
    <td><div class="dish-cell"><button class="thumb thumb-btn" data-action="edit-food" data-id="${item.id}" aria-label="Change photo of ${esc(item.name)}" title="Change photo">${photo(item)}<span class="thumb-cam">${ico('image')}</span></button><div><strong>${esc(item.name)}</strong><br><span class="muted">${esc(item.desc)}</span></div></div></td>
    <td data-label="Price"><label class="inline-input">₹<input aria-label="Price for ${esc(item.name)}" type="number" min="1" value="${item.price}" data-price="${item.id}"></label></td>
    <td data-label="Stock"><input class="stock-input" aria-label="Stock for ${esc(item.name)}" type="number" min="0" placeholder="∞" value="${item.stock ?? ''}" data-stock="${item.id}"></td>
    <td data-label="Today"><button class="toggle ${item.available ? 'on' : ''}" data-action="toggle-food" data-id="${item.id}" aria-label="Toggle ${esc(item.name)}" aria-pressed="${item.available}"></button></td>
    <td><div class="row-actions"><button class="icon-btn" data-action="edit-food" data-id="${item.id}" aria-label="Edit ${esc(item.name)}" title="Edit">${ico('edit')}</button><button class="icon-btn danger" data-action="delete-food" data-id="${item.id}" aria-label="Delete ${esc(item.name)}" title="Delete">${ico('trash')}</button></div></td></tr>`).join('')}</tbody></table></div>
  <p class="footer-note">Tap a photo or the pencil to edit the ${itemLabel} name, description, photo, price and stock. Leave stock empty for unlimited. Stock reduces automatically when orders are placed and returns if an order is cancelled.</p>`;
}
const hhmm = ([h, m]) => String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
function adminShifts() {
  const s = SHIFTS[0], f = (k, label, v) => `<div class="field"><label>${label}</label><input type="time" name="${k}" value="${hhmm(v)}" required></div>`;
  return `${pageHead('Shifts', 'Booking and delivery times shown to students')}
  <form id="shifts-form" class="shift-admin"><div class="panel"><h3>Daily booking shift</h3><div class="form-grid">
    ${f('open', 'Booking opens', s.open)}${f('close', 'Booking closes', s.close)}${f('ds', 'Delivery starts', s.dStart)}${f('de', 'Delivery ends', s.dEnd)}</div></div>
  <div><button class="primary-btn" type="submit">Save times</button></div></form>
  <p class="footer-note">Times use the device clock (IST on the hostel's devices). Booking closes automatically when a window ends.</p>`;
}
function adminGame() {
  return `${pageHead('Game controls')}
  <form id="game-form" class="game-settings-inline"><h2>Game settings</h2><div class="game-settings-fields">
    <label class="game-toggle"><input name="enabled" type="checkbox" ${state.gameConfig.enabled ? 'checked' : ''}> Students can play</label>
    <div class="field"><label>Minimum discount (₹)</label><input name="minDiscount" type="number" min="0" step="1" value="${state.gameConfig.minDiscount}" required></div>
    <div class="field"><label>Maximum discount (₹)</label><input name="maxDiscount" type="number" min="0" step="1" value="${state.gameConfig.maxDiscount}" required></div>
    <div class="field"><label>Target speed (1–3.5×)</label><input name="targetSpeed" type="number" min="1" max="3.5" step="0.1" value="${state.gameConfig.targetSpeed}" required></div>
  </div><button class="primary-btn" type="submit">Save game settings</button></form>
  <div class="game-actions-only"><button class="secondary-btn" type="button" data-action="trial-game">Play a trial game</button>
  <button class="secondary-btn" type="button" data-action="replay-all-students">Replay for all played students</button></div>`;
}
function drinksSettings() {
  const c = state.drinksConfig || { enabled: false, nextOpenAt: null };
  const localTime = c.nextOpenAt ? new Date(c.nextOpenAt).toISOString().slice(0, 16) : '';
  return `${pageHead('Fresh juice access', 'Choose when the fresh juice section is available to students.')}
  <form id="drinks-settings-form" class="game-settings-inline"><h2>Juice availability</h2><div class="game-settings-fields">
    <label class="game-toggle"><input name="enabled" type="checkbox" ${c.enabled ? 'checked' : ''}> Show fresh juice now</label>
    <div class="field"><label>Next opening time</label><input name="nextOpenAt" type="datetime-local" value="${localTime}"></div>
  </div><button class="primary-btn" type="submit">Save juice access</button></form>
  <p class="footer-note">When access is off, students see the centered opening countdown. Fresh juice has no food booking shifts.</p>`;
}

/* photo upload: resized in the browser so it stays small and sharp */
let pendingImage, pendingBlob;   // pendingImage: undefined = unchanged, null = removed, string = new data URL (preview); pendingBlob = file to upload in cloud mode
function readPhoto(file) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file), im = new Image();
    im.onload = () => {
      // centre-crop to portrait 4:5 (the student frame), max 800×1000 — so a photo always fills the frame, with no gaps
      const R = 0.8; let sw = im.width, sh = im.height;
      if (sw / sh > R) sw = Math.round(sh * R); else sh = Math.round(sw / R);
      const k = Math.min(1, 800 / sw), c = document.createElement('canvas');
      c.width = Math.round(sw * k); c.height = Math.round(sh * k);
      c.getContext('2d').drawImage(im, (im.width - sw) / 2, (im.height - sh) / 2, sw, sh, 0, 0, c.width, c.height); URL.revokeObjectURL(url); c.toBlob(blob => res({ url: c.toDataURL('image/jpeg', 0.86), blob }), 'image/jpeg', 0.86);
    };
    im.onerror = () => { URL.revokeObjectURL(url); rej(new Error('bad image')); }; im.src = url;
  });
}
function foodModal(id) {
  const item = id ? activeMenu().find(x => x.id === id) : null; pendingImage = undefined; pendingBlob = undefined;
  const preview = item?.image ? `<img src="${esc(imgSrc(item.image))}" alt="">` : `<span class="ph">${esc((item?.name || '+')[0])}</span>`;
  openModal(`${modalHead(item ? 'Edit food item' : 'Add food item')}<form id="food-form" class="form-grid" data-id="${item ? item.id : ''}">
    <div class="field full-width"><label>Photo</label><div class="photo-edit"><div class="photo-preview" id="photo-preview">${preview}</div>
      <div class="photo-btns"><span class="muted small">Cropped to a portrait frame, so it always fills the picture.</span><label class="secondary-btn file-btn">${ico('image')} ${item?.image ? 'Change photo' : 'Upload photo'}<input type="file" accept="image/*" id="photo-input" hidden></label>${item?.image ? '<button type="button" class="link-btn" data-action="remove-photo">Remove photo</button>' : ''}</div></div></div>
    <div class="field full-width"><label>Name</label><input name="name" required placeholder="e.g. Lemon Rice" value="${esc(item?.name || '')}"></div>
    <div class="field full-width"><label>Description</label><input name="desc" placeholder="Short description" value="${esc(item?.desc || '')}"></div>
    <div class="field"><label>Price (₹)</label><input name="price" type="number" min="1" required value="${item ? item.price : ''}"></div>
    <div class="field"><label>Stock (optional)</label><input name="stock" type="number" min="0" placeholder="Unlimited" value="${item?.stock ?? ''}"></div>
    <div class="field full-width"><button class="primary-btn full" type="submit">${item ? 'Save changes' : 'Add to menu'}</button></div></form>`, 'food');
}

/* ---------------- delivery ---------------- */
const roomNum = r => parseInt(String(r).replace(/\D/g, ''), 10) || 0;
function deliveryCard(o, compact = false) {
  const go = o.status === 'Ready for pickup' || o.status === 'Out for delivery';   // contact shown only once the order is in a delivery agent's hands
  const action = o.status === 'Ready for pickup' ? `<button class="primary-btn full" data-action="pickup" data-id="${o.id}">Picked up</button>`
    : o.status === 'Out for delivery' ? `<form class="otp-form" data-otp-order="${esc(o.id)}"><label>Student’s 4-digit OTP</label><div><input name="otp" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{4}" maxlength="4" required placeholder="Enter OTP"><button class="primary-btn" type="submit">Verify &amp; deliver</button></div></form>`
    : o.status === 'Delivered' ? '' : `<div class="muted small center">Kitchen: ${esc(o.status)}</div>`;
  return `<article class="delivery-card ${go ? '' : 'waiting'}"><div class="d-top"><div class="d-room">${compact ? 'Room' : 'Floor ' + esc(o.customer.floor) + ' · Room'} ${esc(o.customer.room)}</div><span class="status ${statusClass(o.status)}">${esc(o.status)}</span></div>
  <div class="d-items">${o.items.map(i => `${i.qty} × ${esc(i.name)}`).join(' · ')}</div>
  <div class="d-meta"><span>${o.shift ? esc(o.shift.label) + ' · ' : ''}${esc(o.customer.name)} · ${esc(o.id)}</span><b>${money(o.total)}</b></div>
  ${go ? `<a class="call-link" href="tel:${esc(o.customer.phone)}">Call ${esc(o.customer.phone)}</a>` : ''}${action}</article>`;
}
function deliveryPage() {
  const orders = activeOrders();
  if (state.page === 'delivery-history') {
    const done = orders.filter(o => o.status === 'Delivered');
    return `${pageHead(state.business === 'drinks' ? 'Drinks completed' : 'Completed', 'Recently delivered orders')}${done.length ? done.map(o => deliveryCard(o)).join('') : empty('Completed deliveries will appear here.')}`;
  }
  const active = orders.filter(o => !['Delivered', 'Cancelled'].includes(o.status));
  const floorN = o => Number(o.customer.floor) || floorOf(o.customer.room);
  const floors = [...new Set(active.map(floorN))].sort((x, y) => y - x);          // floors: highest first
  const col = (b, list) => `<div class="block-col"><h4>Block ${b}<span>${list.length}</span></h4>${list.length
    ? list.sort((x, y) => roomNum(y.customer.room) - roomNum(x.customer.room)).map(o => deliveryCard(o, true)).join('')   // rooms: highest first
    : '<div class="none">No orders</div>'}</div>`;
  const sections = floors.map(f => { const here = active.filter(o => floorN(o) === f); return `<section class="floor-group"><div class="floor-head"><h3>Floor ${f}</h3><span>${here.length} ${here.length === 1 ? 'order' : 'orders'}</span></div><div class="block-cols">${['A', 'B'].map(b => col(b, here.filter(o => o.customer.block === b))).join('')}</div></section>`; }).join('');
  return `${pageHead(state.business === 'drinks' ? 'Drinks deliveries' : 'Deliveries', 'Top floor first · Block A and B · highest room first')}${sections || empty('No active deliveries right now.')}`;
}

/* ---------------- shell ---------------- */
function pageContent() {
  if (state.role === 'student') return state.page === 'orders' ? studentOrders() : state.page === 'drinks' ? drinksPage() : state.page === 'profile' ? profilePage() : menuPage();
  if (state.role === 'admin') return state.page === 'orders' ? adminOrders() : state.page === 'menu-admin' ? adminMenu() : state.page === 'shifts-admin' ? adminShifts() : state.page === 'drinks-settings' ? drinksSettings() : state.page === 'game-admin' ? adminGame() : adminOverview();
  return deliveryPage();
}
function render() {
  const hero = '';
  app.innerHTML = `<div class="app-shell role-${state.role}${hero}">${header()}<main class="page" id="page">${pageContent()}</main>${mobileNav()}</div>`;
  window.scrollTo(0, 0);
}
function refreshCart() {
  const item = todayItem(), box = document.getElementById('order-box');
  if (item && box) box.innerHTML = orderBox(item);
}
let toastTimer = 0;
function showToast(msg, duration = 2400) {
  clearTimeout(toastTimer);
  document.querySelector('.toast')?.remove();
  const el = Object.assign(document.createElement('div'), { className: 'toast', textContent: msg, role: 'status' });
  document.body.append(el); toastTimer = setTimeout(() => el.remove(), duration);
}
function openModal(content, kind = '') {
  document.querySelector('.modal-backdrop')?.remove();
  const back = document.createElement('div'); back.className = 'modal-backdrop';
  back.innerHTML = `<section class="modal" data-kind="${kind}" role="dialog" aria-modal="true">${content}</section>`;
  back.addEventListener('mousedown', e => { if (e.target === back) closeModal(); });
  document.body.append(back);
}
const closeModal = () => document.querySelector('.modal-backdrop')?.remove();
const modalHead = t => `<div class="modal-head"><h2>${t}</h2><button class="close-btn" data-action="close-modal" aria-label="Close">${ico('close')}</button></div>`;

/* ---------------- cart & checkout ---------------- */
function checkoutModal() {
  if (!state.checkoutKey) state.checkoutKey = uid();   // one key per order attempt => submit can never create two orders
  const previousDiscount = state.pendingGameReward ? discountNow() : 0;
  const canPlayNow = !state.gamePlayed && state.gameConfig.enabled;
  const playLabel = state.pendingGameReward && !canPlayNow ? `Previous discount · ${money(previousDiscount)}` : state.gamePlayed ? 'Your game chance has been used' : !state.gameConfig.enabled ? 'Game temporarily unavailable' : 'Play for a surprise discount';
  openModal(`${modalHead('Where shall we bring it?')}<form id="checkout-form" class="form-grid">${fields(state.profile)}
  <div class="field full-width">${state.pendingGameReward && canPlayNow ? `<p class="previous-reward-note">Your previous ${money(previousDiscount)} discount is saved. You may use it now or play this shift’s game.</p>` : ''}<button class="primary-btn full" type="submit" ${canPlayNow ? '' : 'disabled'}>${playLabel}</button><button class="secondary-btn full" type="button" data-action="skip-game">${state.pendingGameReward ? `Continue with previous ${money(previousDiscount)} discount` : 'Continue without playing'}</button></div></form>`, 'checkout');
}
function readCheckout() {
  const d = Object.fromEntries(new FormData(document.querySelector('#checkout-form')).entries());
  if (!/^[0-9]{10}$/.test(d.phone || '')) { showToast('Enter a valid 10-digit mobile number'); return null; }
  if (!/^[0-9]{3,4}$/.test(d.room || '')) { showToast('Enter a valid room number'); return null; }
  d.floor = String(floorOf(d.room)); state.checkout = d; state.profile = d; persist(); return d;
}
const discountNow = () => {
  if (CLOUD) {
    const reward = state.cloudGame || state.pendingGameReward;
    if (reward?.discount != null) return Math.min(subtotal(), Number(reward.discount));
    return reward ? computeDiscount({ subtotal: subtotal(), accuracy: reward.accuracy, ringScores: reward.ringScores, minDiscount: reward.minDiscount ?? state.gameConfig.minDiscount, maxDiscount: reward.maxDiscount ?? state.gameConfig.maxDiscount }) : 0;
  }
  const challengeId = state.challengeId || state.pendingGameReward?.id;
  if (challengeId && state.pendingGameReward?.id === challengeId && state.pendingGameReward.discount != null) return Math.min(subtotal(), Number(state.pendingGameReward.discount));
  return challengeId ? previewDiscount(challengeId) : 0;
};
async function launchGame() {
  if (state.gamePlayed || !state.gameConfig.enabled) { showToast(state.gamePlayed ? 'You have already used your game chance.' : 'The game is temporarily unavailable.'); reviewModal(); return; }
  closeModal(); state.cloudGame = null;
  if (CLOUD) { try { const challenge = await cloud.startGame(); state.challengeId = challenge.id; state.challengeMinDiscount = Number(challenge.min_discount); state.challengeMaxDiscount = Number(challenge.max_discount); state.gamePlayed = true; state.gameConfig = { ...state.gameConfig, minDiscount: challenge.min_discount, maxDiscount: challenge.max_discount, targetSpeed: challenge.target_speed }; } catch (e) { showToast(e.message); if (/already used/i.test(e.message)) state.gamePlayed = true; reviewModal(); return; } } else { try { issueChallenge(); } catch (e) { showToast(e.message); reviewModal(); return; } }
  const layer = document.createElement('div'); layer.className = 'game-screen';
  layer.innerHTML = `<div class="game-frame"><div class="game-stage"></div><button class="game-back" aria-label="Exit game">${ico('back')}</button></div>`;
  document.body.append(layer);
  const frame = layer.querySelector('.game-frame');
  const leave = () => { game.destroy(); layer.remove(); };
  const game = mountGame(layer.querySelector('.game-stage'), async result => {
    let earned;
    if (CLOUD) { try { const r = await cloud.submitGame(state.challengeId, result); state.cloudGame = r.hit == null ? null : { hit: r.hit, bullseye: r.bullseye, accuracy: r.accuracy, arrows: r.arrows, ringScores: result.ringScores, arrowRewards: (r.arrow_rewards || []).map(Number), discount: Number(r.reward_amount), minDiscount: state.challengeMinDiscount ?? state.gameConfig.minDiscount, maxDiscount: state.challengeMaxDiscount ?? state.gameConfig.maxDiscount }; } catch { state.cloudGame = null; } earned = discountNow(); }
    else earned = submitGameResult(state.challengeId, result);
    frame.querySelector('.game-back').remove();
    const payouts = (state.cloudGame?.arrowRewards?.length ? state.cloudGame.arrowRewards : arrowRewardsForScores(result.ringScores, state.challengeMinDiscount ?? state.gameConfig.minDiscount, state.challengeMaxDiscount ?? state.gameConfig.maxDiscount));
    const payoutLines = Array.from({ length: 4 }, (_, i) => `Arrow ${i + 1}: ${money2(payouts[i] || 0)}`).join(' · ');
    frame.insertAdjacentHTML('beforeend', `<div class="game-result"><div><p class="r-title">${result.hit ? 'Well aimed' : 'Thank you for playing'}</p><div class="r-amount">${money(earned)} off</div><p class="r-sub">${payoutLines}<br>Arrow payouts added to your reservation</p><button class="primary-btn full" id="apply-reward">Continue</button></div></div>`);
    frame.querySelector('#apply-reward').addEventListener('click', () => { leave(); reviewModal(); });
  }, { targetSpeed: state.gameConfig.targetSpeed });
  layer.querySelector('.game-back').addEventListener('click', () => { leave(); state.challengeId = null; state.cloudGame = null; reviewModal(); });
}
function launchTrialGame() {
  const config = { ...state.gameConfig };
  const layer = document.createElement('div'); layer.className = 'game-screen';
  layer.innerHTML = `<div class="game-frame"><div class="game-stage"></div><button class="game-back" aria-label="Exit trial game">${ico('back')}</button></div>`;
  document.body.append(layer);
  const frame = layer.querySelector('.game-frame');
  const leave = () => { game.destroy(); layer.remove(); };
  const game = mountGame(layer.querySelector('.game-stage'), result => {
    const payouts = arrowRewardsForScores(result.ringScores, config.minDiscount, config.maxDiscount);
    const amount = computeDiscount({ subtotal: Number.MAX_SAFE_INTEGER, ringScores: result.ringScores, minDiscount: config.minDiscount, maxDiscount: config.maxDiscount });
    frame.querySelector('.game-back').remove();
    const payoutLines = payouts.map((value, i) => `Arrow ${i + 1}: ${money2(value)}`).join(' · ');
    frame.insertAdjacentHTML('beforeend', `<div class="game-result"><div><p class="r-title">Trial complete</p><div class="r-amount">${money(amount)} sample discount</div><p class="r-sub">${payoutLines}<br>Missed arrows earn ₹0 · No student reward was saved</p><button class="primary-btn full" id="finish-trial">Finish trial</button></div></div>`);
    frame.querySelector('#finish-trial').addEventListener('click', leave);
  }, { targetSpeed: config.targetSpeed });
  layer.querySelector('.game-back').addEventListener('click', leave);
}
function reviewModal() {
  const total = subtotal(), discount = discountNow();
  const drinks = state.business === 'drinks', actionLabel = drinks ? 'Confirm booking' : 'Confirm reservation';
  openModal(`${modalHead(drinks ? 'Your juice booking' : 'Your reservation')}<div class="review-lines">${cartEntries().map(({ item, qty }) => `<div class="cart-row"><strong>${qty} × ${esc(item.name)}</strong><b>${money(qty * item.price)}</b></div>`).join('')}</div>
  <div class="summary-line"><span>Subtotal</span><strong>${money(total)}</strong></div>
  <div class="summary-line"><span>Discount</span><strong class="accent">−${money(discount)}</strong></div>
  <div class="summary-line total"><span>Total</span><strong>${money(total - discount)}</strong></div>
  <button class="primary-btn full" id="place-order" data-action="place-order" data-label="${actionLabel} · ${money(total - discount)}">${actionLabel} · ${money(total - discount)}</button>${drinks ? '' : '<p class="footer-note">Payment is settled directly with the hostel kitchen.</p>'}`, 'review');
}
async function submitOrder(btn) {
  if (state.placing) return;
  state.placing = true; btn.disabled = true; btn.textContent = 'Reserving…';
  if (CLOUD) {   // the server recomputes prices, stock, shift and discount; a retry with the same key returns the same order
    const label = btn.dataset.label;
    try {
      await cloud.placeOrder({ key: state.checkoutKey, items: cartEntries().map(({ item, qty }) => ({ id: item.id, qty })), customer: state.checkout, challengeId: state.challengeId || state.pendingGameReward?.id || null });
      state.cart = {}; state.challengeId = null; state.cloudGame = null; state.pendingGameReward = null; state.challengeMinDiscount = null; state.challengeMaxDiscount = null; state.checkoutKey = null; state.profile = { ...state.profile, ...state.checkout }; persist();
      lastSig = await cloud.refreshData(); state.placing = false; closeModal(); state.page = 'orders'; render(); showToast('Your meal is reserved. Thank you.');
    } catch (e) { state.placing = false; btn.disabled = false; btn.textContent = label; showToast(e.message); }
    return;
  }
  const r = placeOrder({ key: state.checkoutKey, customer: { ...state.checkout }, challengeId: state.challengeId || state.pendingGameReward?.id });
  state.placing = false;
  if (!r.ok) { btn.disabled = false; showToast(r.error); closeModal(); render(); return; }
  closeModal(); state.role = 'student'; state.page = 'orders'; render(); showToast(r.duplicate ? 'Already reserved' : 'Your meal is reserved. Thank you.');
}

/* ---------------- events ---------------- */
function changeQty(id, d) {
  const item = findMenuItem(id); if (!item) return;
  const next = Math.min(maxQty(item), Math.max(0, (state.cart[id] || 0) + d));
  if (next) state.cart = { ...state.cart, [id]: next }; else { const cart = { ...state.cart }; delete cart[id]; state.cart = cart; }
  persist(); if (state.page === 'drinks') render(); else refreshCart();
}
/** Runs a server action, then reloads data and redraws. Errors are shown and the screen is re-synced from the server. */
async function run(fn, okMsg) {
  try { const result = await fn(); lastSig = await cloud.refreshData(); render(); if (okMsg) showToast(typeof okMsg === 'function' ? okMsg(result) : okMsg); }
  catch (e) { showToast(e.message || 'Something went wrong'); try { lastSig = await cloud.refreshData(); } catch {} render(); }
}
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-action]'); if (!b) return;
  const id = b.dataset.id;
  switch (b.dataset.action) {
    case 'nav': {
      const page = b.dataset.page;
      const nextBusiness = page === 'drinks' ? 'drinks' : page === 'menu' ? 'food' : state.business;
      if (nextBusiness !== state.business) { state.cart = {}; state.business = nextBusiness; }
      state.page = page; state.query = ''; render(); break;
    }
    case 'student-orders-filter': state.ordersTab = b.dataset.filter; render(); break;
    case 'qty': changeQty(id, Number(b.dataset.delta)); break;
    case 'close-modal': closeModal(); break;
    case 'checkout': if (state.business !== 'drinks' && !bookingShift()) { showToast('Booking is closed right now'); refreshCart(); break; } closeModal(); checkoutModal(); break;
    case 'skip-game': if (readCheckout()) { state.challengeId = null; state.cloudGame = null; reviewModal(); } break;
    case 'place-order': submitOrder(b); break;
    case 'trial-game': if (PORTAL_ROLE === 'admin') launchTrialGame(); break;
    case 'replay-all-students': if (PORTAL_ROLE === 'admin') { if (CLOUD) run(() => cloud.grantGameReplayAll(), count => count ? `Another chance granted to ${count} student${count === 1 ? '' : 's'}` : 'No played students need another chance'); else showToast('Student game access requires the connected portal.'); } break;
    case 'add-food': foodModal(); break;
    case 'edit-food': foodModal(id); break;
    case 'remove-photo': pendingImage = null; document.getElementById('photo-preview').innerHTML = '<span class="ph">–</span>'; b.remove(); break;
    case 'delete-food': { const it = activeMenu().find(x => x.id === id); if (it && confirm(`Delete “${it.name}” from the menu? Past orders keep their record.`)) { if (CLOUD) await run(() => cloud.deleteMenuItem(id), 'Menu item deleted'); else { removeItem(id); render(); showToast('Menu item deleted'); } } break; }
    case 'toggle-food': {
      const f = activeMenu().find(x => x.id === id); if (!f) break;
      const on = !f.available; state.cart = {};
      if (CLOUD) { await run(() => state.business === 'drinks' ? cloud.setDrinkAvailability(id, on) : cloud.setTodayMeal(on ? id : null), on ? `${f.name} is available today` : `${f.name} is unavailable`); break; }
      if (state.business === 'food') state.menu.forEach(x => x.available = false);
      f.available = on; persist(); render(); showToast(on ? `${f.name} is available today` : `${f.name} is unavailable`); break;
    }
    case 'admin-filter': adminFilter = b.dataset.filter; render(); break;
    case 'pickup': if (CLOUD) await run(() => cloud.setStatus(id, 'Out for delivery')); else { updateOrder(id, { status: 'Out for delivery' }); render(); } break;
    case 'deliver': if (CLOUD) await run(() => cloud.setStatus(id, 'Delivered'), 'Marked delivered'); else { updateOrder(id, { status: 'Delivered' }); render(); showToast('Marked delivered'); } break;
    case 'cancel-order': if (confirm('Cancel this order?')) { if (CLOUD) await run(() => cloud.cancelMyOrder(id), 'Order cancelled'); else { updateOrder(id, { status: 'Cancelled' }); render(); showToast('Order cancelled'); } } break;
    case 'signout': if (CLOUD) await cloud.signOut(); else { staffLock(PORTAL); authMsg = ''; authScreen(); } break;
    case 'retry-student': location.reload(); break;
    case 'auth-mode': authMode = authMode === 'signin' ? 'signup' : 'signin'; authMsg = ''; authScreen(); break;
  }
});
// A missing/broken photo must never show a different food: fall back to a neutral tile.
document.addEventListener('error', e => { const img = e.target; if (img.tagName === 'IMG' && img.closest('.arch,.hero-pack,.thumb')) { img.replaceWith(Object.assign(document.createElement('span'), { className: 'ph', textContent: (img.alt || '?')[0] })); } }, true);

document.addEventListener('change', e => {   // the photo picker lives inside a modal (outside #app)
  const t = e.target; if (t.id !== 'photo-input') return;
  const f = t.files[0]; if (!f) return;
  readPhoto(f).then(({ url, blob }) => { pendingImage = url; pendingBlob = blob; document.getElementById('photo-preview').innerHTML = `<img src="${url}" alt="">`; }).catch(() => showToast('Could not read that image'));
});
app.addEventListener('change', async e => {
  const t = e.target;
  if (t.dataset.orderStatus) { if (CLOUD) await run(() => cloud.setStatus(t.dataset.orderStatus, t.value)); else { updateOrder(t.dataset.orderStatus, { status: t.value }); render(); } }
  if (t.dataset.agent) { if (CLOUD) await run(() => cloud.setAgent(t.dataset.agent, t.value), 'Agent assigned'); else { updateOrder(t.dataset.agent, { agent: t.value }); showToast('Agent assigned'); } }
  if (t.dataset.price) { const item = activeMenu().find(x => x.id === t.dataset.price), v = Number(t.value); if (item && v > 0) { if (CLOUD) await run(() => cloud.patchItem(item.id, { price: v }), 'Price updated'); else { item.price = v; persist(); showToast('Price updated'); } } else render(); }
  if (t.dataset.stock !== undefined && CLOUD) { const item = activeMenu().find(x => x.id === t.dataset.stock); if (item) await run(() => cloud.patchItem(item.id, { stock: t.value === '' ? null : Math.max(0, Math.floor(Number(t.value))) }), 'Stock updated'); return; }
  if (t.dataset.stock !== undefined) { const item = activeMenu().find(x => x.id === t.dataset.stock); if (item) { item.stock = t.value === '' ? null : Math.max(0, Math.floor(Number(t.value))); if (item.stock != null && state.cart[item.id] > item.stock) { item.stock ? state.cart[item.id] = item.stock : delete state.cart[item.id]; } persist(); render(); showToast('Stock updated'); } }
});
document.addEventListener('submit', e => {
  e.preventDefault(); const f = e.target, d = Object.fromEntries(new FormData(f).entries());
  if (f.id === 'checkout-form') { if (readCheckout()) launchGame(); }
  else if (f.id === 'food-form') {
    const data = { name: d.name.trim(), desc: d.desc.trim() || 'Freshly prepared', price: Math.max(1, Math.round(Number(d.price))), stock: d.stock === '' ? null : Math.max(0, Math.floor(Number(d.stock))) };
    const editing = f.dataset.id, photo = pendingImage === undefined ? undefined : (pendingImage === null ? null : pendingBlob);
    if (CLOUD) { closeModal(); showToast('Saving…'); run(() => editing ? cloud.saveMenuItem(editing, data, photo) : cloud.addMenuItem(data, photo), editing ? 'Saved' : 'Added — switch it on to serve it today'); return; }
    if (editing) { if (pendingImage !== undefined) data.image = pendingImage; saveItem(editing, data); closeModal(); render(); showToast('Saved'); }
    else { addItem({ ...data, image: pendingImage || null }); closeModal(); render(); showToast('Added — switch it on to serve it today'); }
  }
  else if (f.id === 'shifts-form') {
    const tm = v => v.split(':').map(Number);
    const list = [{ open: tm(d.open), close: tm(d.close), dStart: tm(d.ds), dEnd: tm(d.de) }];
    if (CLOUD) { run(() => cloud.saveShifts(list), 'Shift times saved'); return; }
    updateShifts(list); render(); showToast('Shift times saved');
  }
  else if (f.id === 'game-form') {
    const minDiscount = Math.floor(Number(d.minDiscount)), maxDiscount = Math.floor(Number(d.maxDiscount));
    if (!Number.isFinite(minDiscount) || !Number.isFinite(maxDiscount) || minDiscount < 0 || maxDiscount < minDiscount) { showToast('Enter a maximum discount at least as high as the minimum'); return; }
    const config = { enabled: f.elements.enabled.checked, minDiscount, maxDiscount, targetSpeed: Math.min(3.5, Math.max(1, Number(d.targetSpeed))) };
    if (CLOUD) { run(() => cloud.saveGameConfig(config), 'Game settings saved'); return; }
    state.gameConfig = config; persist(); render(); showToast('Game settings saved');
  }
  else if (f.id === 'drinks-settings-form') {
    const enabled = f.elements.enabled.checked;
    const nextOpenAt = d.nextOpenAt ? new Date(d.nextOpenAt).toISOString() : null;
    if (!enabled && !nextOpenAt) { showToast('Choose the next opening time'); return; }
    const config = { enabled, nextOpenAt };
    if (CLOUD) { run(() => cloud.saveDrinksConfig(config), 'Fresh juice access saved'); return; }
    state.drinksConfig = config; state.drinksLaunchAt = enabled ? null : nextOpenAt; persist(); render(); showToast('Fresh juice access saved');
  }
  else if (f.id === 'game-replay-form') {
    if (!CLOUD) { showToast('Student game access requires the connected portal.'); return; }
    run(() => cloud.grantGameReplay(d.phone), 'Another game chance is available for that student');
  }
  else if (f.matches('.otp-form')) {
    if (!CLOUD) { showToast('OTP verification requires the secure Supabase backend.'); return; }
    run(() => cloud.verifyDeliveryOtp(f.dataset.otpOrder, d.otp), 'Order marked delivered');
  }
  else if (f.id === 'auth-form') { doAuth(d, f.querySelector('button[type=submit]')); }
});

/* ---------------- cloud: sign-in, startup, live refresh ---------------- */
let authMode = 'signin', authMsg = '', lastSig = '', pollTimer = 0;
function studentStartupError(message) {
  app.innerHTML = `<div class="auth"><div class="auth-card">${brand()}<h1>Yomato is starting</h1><p class="auth-sub">${esc(message || 'We could not connect to the student dashboard yet.')}</p><button class="primary-btn full big" data-action="retry-student">Try again</button></div></div>`;
}
function authScreen() {
  const staff = PORTAL !== 'student', su = !staff && authMode === 'signup';
  app.innerHTML = `<div class="auth"><div class="auth-card">${brand()}
    <h1>${su ? 'Create your account' : staff ? (PORTAL_ROLE === 'admin' ? `${BUSINESS === 'drinks' ? 'Drinks admin' : 'Admin'} sign in` : `${BUSINESS === 'drinks' ? 'Drinks delivery' : 'Delivery'} sign in`) : 'Welcome'}</h1><p class="auth-sub">${su ? 'A few details so we can bring your meal to the right door.' : staff ? 'Staff only. Enter your email and password.' : 'Please sign in to reserve today’s meal.'}</p>
    <form id="auth-form" class="form-grid">
      ${su ? `<div class="field full-width"><label>Full name</label><input name="name" autocomplete="name" required></div>
      <div class="field full-width"><label>Mobile number</label><input name="phone" inputmode="numeric" pattern="[0-9]{10}" maxlength="10" placeholder="10-digit mobile number" autocomplete="tel" required></div>
      <div class="field"><label>Block</label><select name="block"><option value="A">Block A</option><option value="B">Block B</option></select></div>
      <div class="field"><label>Room number</label><input name="room" inputmode="numeric" pattern="[0-9]{3,4}" maxlength="4" placeholder="Enter your room number" required></div>` : ''}
      <div class="field full-width"><label>${!CLOUD && staff ? `${PORTAL_ROLE === 'admin' ? 'Admin' : 'Delivery'} ID` : 'Email'}</label><input name="email" ${!CLOUD && staff ? '' : 'type="email"'} autocomplete="${!CLOUD && staff ? 'username' : 'email'}" ${!CLOUD && staff ? 'autocapitalize="characters"' : ''} required></div>
      <div class="field full-width"><label>Password</label><input name="password" type="password" ${!CLOUD && staff ? '' : 'minlength="6" '}autocomplete="${su ? 'new-password' : 'current-password'}" required></div>
      ${authMsg ? `<p class="auth-msg full-width" role="status">${esc(authMsg)}</p>` : ''}
      <div class="field full-width"><button class="primary-btn full big" type="submit">${su ? 'Create account' : 'Sign in'}</button></div>
    </form>
    ${staff ? '' : `<p class="auth-switch">${su ? 'Already have an account?' : 'New here?'} <button class="link-btn" data-action="auth-mode">${su ? 'Sign in' : 'Create an account'}</button></p>`}</div></div>`;
}
async function doAuth(d, btn) {
  btn.disabled = true; authMsg = '';
  try {
    if (authMode === 'signup' && PORTAL === 'student') {
      const signedIn = await cloud.signUp({ email: d.email.trim(), password: d.password, name: d.name.trim(), phone: d.phone, block: d.block, room: d.room });
      if (!signedIn) { authMode = 'signin'; authMsg = 'Account created. Check your email to confirm it, then sign in.'; authScreen(); return; }
    } else if (!CLOUD) { staffLogin(PORTAL, d.email, d.password); render(); return; }
    else await cloud.signIn(d.email.trim(), d.password);
    await enterApp();
  } catch (e) { authMsg = e.message; authScreen(); }
}
async function enterApp() {
  const p = await cloud.loadProfile(); if (!p) { authScreen(); return; }
  if (p.role !== PORTAL_ROLE || (PORTAL_ROLE !== 'student' && !['both', BUSINESS].includes(p.business || 'food'))) {   // wrong door: keep staff access limited to its assigned service
    const home = p.role === 'admin' || p.role === 'delivery' ? PORTAL_URL[p.business === 'drinks' ? `${p.business}-${p.role}` : p.role] : PORTAL_URL.student;
    app.innerHTML = `<div class="auth"><div class="auth-card">${brand()}<h1>Wrong portal</h1><p class="auth-sub">This account is a ${esc(p.role)} account and can't open the ${PORTAL} portal.</p><a class="primary-btn full big" href="${home}" style="text-align:center;display:block;text-decoration:none">Go to the ${esc(p.role)} portal</a><button class="secondary-btn full" data-action="signout">Sign out</button></div></div>`;
    return;
  }
  state.profile = { name: p.name, phone: p.phone, block: p.block || 'A', floor: p.floor, room: p.room, email: p.email };
  state.gamePlayed = p.gamePlayed;
  state.business = BUSINESS; state.role = PORTAL_ROLE; state.page = HOME[PORTAL];
  lastSig = await cloud.refreshData();
  render();
  clearInterval(pollTimer); pollTimer = setInterval(poll, 2000);
}
async function poll() {
  if (document.hidden || !sb) return;
  try {
    const sig = await cloud.refreshData(); if (sig === lastSig) return;
    const busy = document.querySelector('.modal-backdrop,.game-screen') || document.activeElement?.closest?.('#page input,#page select');
    if (!busy) { lastSig = sig; render(); }   // if the person is mid-edit, redraw on the next poll instead
  } catch { /* offline: try again next time */ }
}
if (CLOUD) {
  app.innerHTML = '<div class="auth"><div class="auth-card"><div class="auth-sub">Loading…</div></div></div>';
  sb.auth.onAuthStateChange(ev => { if (ev === 'SIGNED_OUT') { clearInterval(pollTimer); state.cart = {}; authMode = 'signin'; authMsg = ''; if (PORTAL === 'student') location.reload(); else authScreen(); } });
  (async () => {
    let s = await cloud.getSession();
    if (PORTAL === 'student') { if (!s) await cloud.signInGuest(); return enterApp(); }   // students: no login screen
    if (s?.user?.is_anonymous) { await sb.auth.signOut({ scope: 'local' }); s = null; }  // a student's guest session must not block the staff sign-in
    return s ? enterApp() : authScreen();
  })().catch(e => { if (PORTAL === 'student') { console.error('Student startup failed', e); studentStartupError(`Could not start the dashboard: ${e?.message || 'connection error'}`); } else { authMsg = 'Could not reach the server. Check your connection and refresh.'; authScreen(); } });
} else if (PORTAL !== 'student' && !staffUnlocked(PORTAL)) authScreen();
else render();
if (import.meta.env.PROD && 'serviceWorker' in navigator && location.protocol.startsWith('http')) window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
