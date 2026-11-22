// First-day game reward is fixed between ₹4 and ₹9. Pure functions only — no UI, no storage.
// The amount is ALWAYS derived here from trusted inputs (cart pack count, cart subtotal, validated game result);
// no code path accepts a discount value from the UI. The same rules are mirrored in supabase-schema.sql
// (place_order) which is the authoritative implementation once the shared backend is connected.
export const MAX_ARROWS = 4;
export const GAME_SECONDS = 25;
export function discountRange() { return [4, 9]; }

/** hit: boolean, shots: arrows used. Miss/no-play-complete => minimum of the tier; hit => max minus extra arrows. */
export function computeDiscount({ subtotal, hit, bullseye = false, accuracy = 0, maxDiscount = 9 }) {
  const [min, max] = discountRange();
  const precision = bullseye ? 1 : (hit ? Math.max(0, Math.min(1, Number(accuracy) || 0)) : 0);
  const earned = min + Math.floor((max - min) * precision);
  return Math.max(0, Math.min(subtotal, earned, Number(maxDiscount) || 4, 9));
}

/** Plausibility check of a submitted game result. Anything implausible is treated as a miss (minimum tier). */
export function sanitizeResult({ hit, bullseye, accuracy, shots, playMs }) {
  const s = Number.isInteger(shots) ? shots : 0;
  const plausible = s >= 1 && s <= MAX_ARROWS && playMs >= s * 350 && playMs <= (GAME_SECONDS + 5) * 1000;
  const score = Math.max(0, Math.min(1, Number(accuracy) || 0));
  return plausible ? { hit: !!hit, bullseye: !!bullseye && !!hit, accuracy: score, shots: s } : { hit: false, bullseye: false, accuracy: 0, shots: Math.min(MAX_ARROWS, Math.max(0, s | 0)) };
}
