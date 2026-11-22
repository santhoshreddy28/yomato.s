// Pure reward calculation — no UI, no storage.
// The amount is ALWAYS derived here from trusted inputs (cart subtotal, validated game result);
// no code path accepts a discount value from the UI. The same rules are mirrored in supabase-schema.sql
// (place_order) which is the authoritative implementation once the shared backend is connected.
export const MAX_ARROWS = 4;
export const GAME_SECONDS = 25;
export function discountRange(minDiscount = 4, maxDiscount = 9) { return [minDiscount, maxDiscount]; }

/** Accuracy determines the reward across the configured range; the order total is the final cap. */
export function computeDiscount({ subtotal, accuracy = 0, minDiscount = 4, maxDiscount = 9 }) {
  const min = Math.max(0, Math.floor(Number(minDiscount) || 0));
  const max = Math.max(min, Math.floor(Number(maxDiscount) || 0));
  const precision = Math.max(0, Math.min(1, Number(accuracy) || 0));
  const earned = Math.round(min + (max - min) * precision);
  return Math.max(0, Math.min(Number(subtotal) || 0, earned));
}

/** Plausibility check of a submitted game result. Anything implausible is treated as a miss (minimum tier). */
export function sanitizeResult({ hit, bullseye, accuracy, shots, playMs }) {
  const s = Number.isInteger(shots) ? shots : 0;
  const plausible = s >= 1 && s <= MAX_ARROWS && playMs >= s * 350 && playMs <= (GAME_SECONDS + 5) * 1000;
  const score = Math.max(0, Math.min(1, Number(accuracy) || 0));
  return plausible ? { hit: !!hit, bullseye: !!bullseye && !!hit, accuracy: score, shots: s } : { hit: false, bullseye: false, accuracy: 0, shots: Math.min(MAX_ARROWS, Math.max(0, s | 0)) };
}
