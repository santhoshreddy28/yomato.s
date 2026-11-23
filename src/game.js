// Yomato archery — portrait 9:16 canvas game. Logical size is 360x640 and is scaled to the frame.
import { GAME_SECONDS, MAX_ARROWS } from './discount.js';

const ARROW_SPEED = 14;   // fixed: drag only chooses direction, never power
const W = 360, H = 640, GOLD = '#e7be5a', IVORY = '#f6eedb', LEAF = '#1f5c45', TARGET_R = 38;

/** Mounts the game into `frame`. Calls onEnd({hit, shots, playMs}) once. Returns { destroy }. */
export function mountGame(frame, onEnd, { targetSpeed = 2.4 } = {}) {
  frame.innerHTML = `<canvas aria-label="Archery game"></canvas><div class="g-timer"><i></i></div><div class="g-arrows" aria-label="Arrows left"></div><div class="g-hint">Use all 4 arrows · drag to aim and release</div>`;
  const canvas = frame.querySelector('canvas'), ctx = canvas.getContext('2d');
  const timerBar = frame.querySelector('.g-timer i'), pips = frame.querySelector('.g-arrows'), hint = frame.querySelector('.g-hint');
  const player = { x: W / 2, y: 560 };
  let scale = 1, raf = 0, last = 0, t = 0, aim = null, arrow = null, shots = 0, done = false, hit = false, bullseye = false, accuracy = 0, arrowBestDistance = Infinity, arrowHit = false, scoreTotal = 0, flash = 0, started = 0;
  const shotData = [];
  const ringScores = [];
  const particles = [];

  const fit = () => {
    const r = frame.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr);
    scale = canvas.width / W;
  };
  const ro = new ResizeObserver(fit); ro.observe(frame); fit();

  const drawPips = () => { pips.innerHTML = Array.from({ length: MAX_ARROWS }, (_, i) => `<span class="${i < MAX_ARROWS - shots ? 'on' : ''}"></span>`).join(''); };
  drawPips();

  // Target: sweeps across the top with a changing rhythm.
  const enemy = (at = t) => ({
    x: W / 2 + Math.sin(at * 0.00055 * targetSpeed) * 100 + Math.sin(at * 0.0013 * targetSpeed + 1) * 22,
    y: 130 + Math.sin(at * 0.00045 * targetSpeed) * 8,
  });

  function line(x1, y1, x2, y2, c, w = 3) { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.strokeStyle = c; ctx.lineWidth = w; ctx.stroke(); }
  // A traditional target (not a figure): concentric rings that glide across the top.
  function target(x, y, flashing) {
    ctx.save(); ctx.shadowColor = GOLD; ctx.shadowBlur = flashing ? 24 : 10;
    const rings = [[TARGET_R, IVORY], [TARGET_R * 0.78, LEAF], [TARGET_R * 0.54, IVORY], [TARGET_R * 0.3, GOLD], [TARGET_R * 0.1, '#8e1f2b']];
    rings.forEach(([r, col], i) => { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = flashing ? '#fff' : col; ctx.fill(); if (i === 0) { ctx.lineWidth = 3; ctx.strokeStyle = GOLD; ctx.stroke(); ctx.shadowBlur = 0; } });
    ctx.restore();
  }
  // The archer is just a bow that turns with your aim.
  function bow(x, y, a) {
    ctx.save(); ctx.translate(x, y - 12); ctx.rotate(a); ctx.lineCap = 'round';
    ctx.strokeStyle = GOLD; ctx.lineWidth = 4; ctx.shadowColor = GOLD; ctx.shadowBlur = 8;
    ctx.beginPath(); ctx.arc(-8, 0, 30, -1.05, 1.05); ctx.stroke();
    const ex = -8 + Math.cos(1.05) * 30, ey = Math.sin(1.05) * 30;
    ctx.shadowBlur = 0; ctx.lineWidth = 1.2; ctx.strokeStyle = IVORY; ctx.beginPath(); ctx.moveTo(ex, -ey); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.restore();
    ctx.save(); ctx.translate(x, y + 18); ctx.rotate(Math.PI / 4); ctx.fillStyle = GOLD; ctx.fillRect(-5, -5, 10, 10); ctx.restore();
  }
  function drawArrow(x, y, a) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(a); ctx.lineCap = 'round'; ctx.strokeStyle = IVORY; ctx.lineWidth = 2.4;
    ctx.beginPath(); ctx.moveTo(-20, 0); ctx.lineTo(9, 0); ctx.stroke();
    ctx.fillStyle = GOLD; ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(6, -4.5); ctx.lineTo(6, 4.5); ctx.closePath(); ctx.fill(); ctx.restore();
  }

  function end() {
    if (done) return; done = true; cancelAnimationFrame(raf);
    onEnd({ hit, bullseye, accuracy, ringScores, shots, playMs: Math.round(t), shotData });
  }
  function finishArrow() {
    const d = arrowBestDistance;
    const ring = d <= 3.8 ? 5 : d <= 11.4 ? 4 : d <= 20.52 ? 3 : d <= 29.64 ? 2 : d <= TARGET_R ? 1 : 0;
    ringScores.push(ring);
    scoreTotal += ring / 5;
    accuracy = scoreTotal / MAX_ARROWS;
    arrowBestDistance = Infinity; arrowHit = false;
  }

  function step(now) {
    if (done) return;
    const dt = Math.min(40, now - (last || now)); last = now;
    t += dt;
    if (!started) started = now;
    timerBar.style.transform = `scaleX(${Math.max(0, 1 - t / (GAME_SECONDS * 1000))})`;

    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    const bg = ctx.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#0c241d'); bg.addColorStop(1, '#08170f'); ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    line(0, 604, W, 604, 'rgba(231,190,90,.25)', 1);

    const e = enemy(t);
    bow(player.x, player.y, aim ? aim.a : -Math.PI / 2);
    target(e.x, e.y, flash > 0);
    if (flash > 0) flash -= dt;

    if (arrow) {
      const k = dt / 16.67;
      for (let s = 0; s < 4 && arrow; s++) {   // small sub-steps so a fast arrow can never skip through the target
        arrow.x += arrow.vx * k / 4; arrow.y += arrow.vy * k / 4;   // straight flight so the scope is exact
        const targetAt = enemy(t - dt + (s + 1) * dt / 4);
        const error = Math.hypot(arrow.x - targetAt.x, arrow.y - targetAt.y);
        arrowBestDistance = Math.min(arrowBestDistance, error);
        if (error < TARGET_R) {
          hit = true; bullseye ||= error <= 3.8;
          if (!arrowHit) {
            arrowHit = true; flash = 160;
            for (let i = 0; i < 18; i++) { const a = Math.random() * 6.28, sp = 0.05 + Math.random() * 0.12; particles.push({ x: targetAt.x, y: targetAt.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 600 }); }
          }
        }
      }
      if (arrow) {
        drawArrow(arrow.x, arrow.y, Math.atan2(arrow.vy, arrow.vx));
        if (arrow.y < -30 || arrow.x < -30 || arrow.x > W + 30 || arrow.y > H + 30) { arrow = null; finishArrow(); }
      }
    }
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i]; p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      ctx.globalAlpha = p.life / 600; ctx.fillStyle = GOLD; ctx.fillRect(p.x, p.y, 3, 3); ctx.globalAlpha = 1;
    }
    if (aim && !arrow) {
      const sx = player.x, sy = player.y - 14;
      ctx.save(); ctx.setLineDash([3, 7]); ctx.strokeStyle = IVORY; ctx.globalAlpha = 0.45; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + Math.cos(aim.a) * 420, sy + Math.sin(aim.a) * 420); ctx.stroke(); ctx.restore();
      // Scope: reticle on the line of flight, at the height of the target.
      const d = (sy - 130) / Math.max(0.2, -Math.sin(aim.a)), rx = sx + Math.cos(aim.a) * d, ry = sy + Math.sin(aim.a) * d;
      ctx.save(); ctx.strokeStyle = GOLD; ctx.lineWidth = 1.5; ctx.shadowColor = GOLD; ctx.shadowBlur = 8;
      ctx.beginPath(); ctx.arc(rx, ry, 15, 0, Math.PI * 2); ctx.stroke();
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) { ctx.beginPath(); ctx.moveTo(rx + dx * 9, ry + dy * 9); ctx.lineTo(rx + dx * 22, ry + dy * 22); ctx.stroke(); }
      ctx.restore();
      drawArrow(sx + Math.cos(aim.a) * 18, sy + Math.sin(aim.a) * 18, aim.a);
    }
    if (!arrow && (t >= GAME_SECONDS * 1000 || shots >= MAX_ARROWS)) { end(); return; }
    raf = requestAnimationFrame(step);
  }

  const pt = ev => { const r = canvas.getBoundingClientRect(); return { x: (ev.clientX - r.left) / r.width * W, y: (ev.clientY - r.top) / r.height * H }; };
  const angleTo = p => {
    const dx = p.x - player.x, dy = p.y - (player.y - 14);
    if (Math.hypot(dx, dy) < 18) return null;
    return Math.atan2(Math.min(dy, -20), dx);      // always shoots upward
  };
  canvas.addEventListener('pointerdown', ev => {
    if (done || arrow || shots >= MAX_ARROWS || t >= GAME_SECONDS * 1000) return;
    canvas.setPointerCapture(ev.pointerId); hint.classList.add('off');
    const a = angleTo(pt(ev)); aim = a == null ? { a: -Math.PI / 2 } : { a };
  });
  canvas.addEventListener('pointermove', ev => { if (!aim) return; const a = angleTo(pt(ev)); if (a != null) aim.a = a; });
  canvas.addEventListener('pointerup', () => {
    if (!aim || done) return;
    const a = aim.a; aim = null;
    shotData.push({ at_ms: Math.round(t), angle: a });
    arrow = { x: player.x + Math.cos(a) * 18, y: player.y - 14 + Math.sin(a) * 18, vx: Math.cos(a) * ARROW_SPEED, vy: Math.sin(a) * ARROW_SPEED };
    shots++; drawPips();
  });
  canvas.addEventListener('pointercancel', () => { aim = null; });

  raf = requestAnimationFrame(step);
  return { destroy() { done = true; cancelAnimationFrame(raf); ro.disconnect(); } };
}

