// Pure reward calculation — no UI, no storage.
// The amount is ALWAYS derived here from trusted inputs (cart subtotal, validated game result);
// no code path accepts a discount value from the UI. The same rules are mirrored in supabase-schema.sql
// (place_order) which is the authoritative implementation once the shared backend is connected.
export const MAX_ARROWS = 4;
export const GAME_SECONDS = 25;
export function discountRange(minDiscount = 4, maxDiscount = 9) { return [minDiscount, maxDiscount]; }

/** Each hit ring earns one arrow's share; the order total is the final cap. */
export function arrowRewardsForScores(ringScores = [], minDiscount = 4, maxDiscount = 9) {
  const min = Math.max(0, Math.floor(Number(minDiscount) || 0));
  const max = Math.max(min, Math.floor(Number(maxDiscount) || 0));
  const minPerArrow = min / MAX_ARROWS;
  const rangePerArrow = (max - min) / MAX_ARROWS;
  return Array.from({ length: MAX_ARROWS }, (_, i) => {
    const ring = Math.max(0, Math.min(5, Math.floor(Number(ringScores[i]) || 0)));
    return ring ? minPerArrow + rangePerArrow * ((ring - 1) / 4) : 0;
  });
}

export function computeDiscount({ subtotal, accuracy = 0, ringScores, minDiscount = 4, maxDiscount = 9 }) {
  const earned = Array.isArray(ringScores) && ringScores.length
    ? Math.round(arrowRewardsForScores(ringScores, minDiscount, maxDiscount).reduce((sum, score) => sum + score, 0))
    : Math.round(Math.max(0, Math.floor(Number(minDiscount) || 0))
      + (Math.max(0, Math.floor(Number(maxDiscount) || 0)) - Math.max(0, Math.floor(Number(minDiscount) || 0))) * Math.max(0, Math.min(1, Number(accuracy) || 0)));
  return Math.max(0, Math.min(Number(subtotal) || 0, earned));
}

/** Plausibility check of a submitted game result. Anything implausible is treated as a miss (minimum tier). */
export function sanitizeResult({ hit, bullseye, accuracy, ringScores, shots, playMs }) {
  const s = Number.isInteger(shots) ? shots : 0;
  const plausible = s >= 1 && s <= MAX_ARROWS && playMs >= s * 350 && playMs <= (GAME_SECONDS + 5) * 1000;
  const score = Math.max(0, Math.min(1, Number(accuracy) || 0));
  const rings = Array.isArray(ringScores) ? ringScores.slice(0, MAX_ARROWS).map(x => Math.max(0, Math.min(5, Math.floor(Number(x) || 0)))) : [];
  return plausible ? { hit: !!hit, bullseye: !!bullseye && !!hit, accuracy: score, ringScores: rings, shots: s } : { hit: false, bullseye: false, accuracy: 0, ringScores: [], shots: Math.min(MAX_ARROWS, Math.max(0, s | 0)) };
}

