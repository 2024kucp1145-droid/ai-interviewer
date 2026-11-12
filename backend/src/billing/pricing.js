/**
 * Pricing Engine — RoundOne AI Platform
 *
 * Structure:
 *  1. Pay-Per-Interview  : priced by duration (10–60 min, $0.25 increments starting from $0.50)
 *  2. Bulk Packs         : every 10 interviews → 1 free
 *  3. Subscription Plans : monthly/multi-month with included interview quotas
 */

import { getPlatformSettingsMap } from '../services/platformConfigService.js';

// ─── 1. PER-INTERVIEW DURATION PRICING ───────────────────────────────────────
export const DURATION_TIERS = [
  { minutes: 10,  priceUsd: 0.50, label: '10 min', subtitle: 'Rapid Screening' },
  { minutes: 20,  priceUsd: 0.75, label: '20 min', subtitle: 'Core Technical' },
  { minutes: 30,  priceUsd: 1.00, label: '30 min', subtitle: 'Standard Full Round' },
  { minutes: 40,  priceUsd: 1.25, label: '40 min', subtitle: 'Architecture & System' },
  { minutes: 50,  priceUsd: 1.50, label: '50 min', subtitle: 'Staff / Senior' },
  { minutes: 60,  priceUsd: 1.75, label: '60 min', subtitle: 'Master 1-Hour' },
];

/**
 * Resolve effective per-interview duration tiers (Admin overrides in `platform_settings` or defaults).
 */
export function getEffectiveDurationTiers() {
  try {
    const s = getPlatformSettingsMap();
    if (s.duration_tiers_json) {
      const parsed = JSON.parse(s.duration_tiers_json);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map(t => ({
          minutes: Number(t.minutes),
          priceUsd: Number(t.priceUsd),
          label: String(t.label || `${t.minutes} min`),
          subtitle: t.subtitle ? String(t.subtitle) : '',
        })).filter(t => t.minutes > 0 && t.priceUsd >= 0);
      }
    }
  } catch (_) {}
  return DURATION_TIERS;
}

/**
 * Get price per interview for a given duration.
 * @param {number} minutes - Duration in minutes (10–60)
 * @returns {{ priceUsd: number, label: string }}
 */
export function getPriceForDuration(minutes) {
  const tiers = getEffectiveDurationTiers();
  const tier = tiers.find(t => t.minutes === Number(minutes));
  if (!tier) throw new Error(`Invalid duration: ${minutes}. Must be one of: ${tiers.map(t => t.minutes).join(', ')}.`);
  return tier;
}

// ─── 2. BULK PACK CALCULATOR ──────────────────────────────────────────────────
/**
 * Calculate bulk-pack pricing.
 * Rule: For every 10 interviews purchased → 1 interview is FREE.
 * Example: Buy 10 → pay for 9 ($9 at $1/each), buy 20 → pay for 18, etc.
 *
 * @param {number} quantity   - Number of interviews requested
 * @param {number} minutes    - Duration per interview (10–60)
 * @returns {{
 *   quantity: number,
 *   freeInterviews: number,
 *   billedFor: number,
 *   pricePerInterview: number,
 *   totalUsd: number,
 *   savingsUsd: number
 * }}
 */
export function calcBulkPack(quantity, minutes) {
  const { priceUsd } = getPriceForDuration(minutes);
  const qty = Math.floor(Number(quantity));
  if (qty < 1) throw new Error('Quantity must be at least 1.');

  const freeInterviews = Math.floor(qty / 10);  // 1 free per every 10
  const billedFor = qty - freeInterviews;
  const totalUsd = +(billedFor * priceUsd).toFixed(2);
  const savingsUsd = +(freeInterviews * priceUsd).toFixed(2);

  return {
    quantity: qty,
    freeInterviews,
    billedFor,
    pricePerInterview: priceUsd,
    totalUsd,
    savingsUsd,
    durationMinutes: Number(minutes),
  };
}

// ─── 3. SUBSCRIPTION PLANS ────────────────────────────────────────────────────
export const SUBSCRIPTION_PLANS = [
  {
    id: 'monthly_1',
    label: '1 Month',
    months: 1,
    priceUsd: 49,
    includedInterviews: 150,
    savingsLabel: null,
    popular: false,
    active: true,
    subtitle: 'Individual hiring',
  },
  {
    id: 'monthly_2',
    label: '2 Months',
    months: 2,
    priceUsd: 79,
    includedInterviews: 280,
    savingsLabel: 'Save $19 vs monthly',
    popular: false,
    active: true,
    subtitle: 'Growing startup',
  },
  {
    id: 'quarterly',
    label: '3 Months',
    months: 3,
    priceUsd: 109,
    includedInterviews: 420,
    savingsLabel: 'Save $38 vs monthly',
    popular: false,
    active: true,
    subtitle: 'Quarterly hiring',
  },
  {
    id: 'biannual',
    label: '6 Months',
    months: 6,
    priceUsd: 219,
    includedInterviews: 900,
    savingsLabel: 'Save $75 vs monthly',
    popular: true,
    active: true,
    subtitle: 'Recruiting agency',
  },
  {
    id: 'annual',
    label: '1 Year',
    months: 12,
    priceUsd: 399,
    includedInterviews: 1800,
    savingsLabel: 'Save $189 vs monthly',
    popular: false,
    active: true,
    subtitle: 'Enterprise scale',
  },
];

/**
 * Resolve effective subscription plans (Admin overrides in `platform_settings` or defaults).
 * @param {{ includeInactive?: boolean }} [opts]
 */
export function getEffectiveSubscriptionPlans({ includeInactive = false } = {}) {
  let list = SUBSCRIPTION_PLANS;
  try {
    const s = getPlatformSettingsMap();
    if (s.subscription_plans_json) {
      const parsed = JSON.parse(s.subscription_plans_json);
      if (Array.isArray(parsed) && parsed.length > 0) {
        list = parsed
          .map((p) => ({
            id: String(p.id || '').trim(),
            label: String(p.label || '').trim(),
            months: Math.max(1, parseInt(p.months, 10) || 1),
            priceUsd: Math.max(0, Number(p.priceUsd) || 0),
            includedInterviews: Math.max(1, parseInt(p.includedInterviews, 10) || 10),
            savingsLabel: p.savingsLabel ? String(p.savingsLabel).trim() : null,
            popular: Boolean(p.popular),
            active: p.active !== false,
            subtitle: p.subtitle ? String(p.subtitle).trim() : '',
          }))
          .filter((p) => p.id && p.label);
      }
    }
  } catch (_) {}
  return includeInactive ? list : list.filter((p) => p.active !== false);
}

/**
 * Get a subscription plan by ID.
 * @param {string} planId
 */
export function getPlan(planId) {
  const plan = getEffectiveSubscriptionPlans({ includeInactive: true }).find(p => p.id === planId);
  if (!plan) throw new Error(`Unknown plan: ${planId}`);
  return plan;
}

/**
 * Calculate cost per interview for a subscription plan.
 * @param {string} planId
 * @returns {{ planId, costPerInterview, ...planDetails }}
 */
export function calcPlanCostPerInterview(planId) {
  const plan = getPlan(planId);
  return {
    ...plan,
    costPerInterview: +(plan.priceUsd / plan.includedInterviews).toFixed(3),
  };
}

// ─── 4. UNIFIED QUOTE BUILDER ─────────────────────────────────────────────────
/**
 * Build a full quote for a pay-per-interview order.
 * @param {{ quantity: number, minutes: number }} opts
 */
export function buildPayPerUseQuote({ quantity, minutes }) {
  const bulk = calcBulkPack(quantity, minutes);
  return {
    type: 'pay_per_use',
    ...bulk,
    breakdown: bulk.quantity > 9
      ? `Buy ${bulk.quantity}, pay for ${bulk.billedFor} (${bulk.freeInterviews} free!)`
      : `${bulk.quantity} × $${bulk.pricePerInterview.toFixed(2)} (${bulk.durationMinutes}-min interviews)`,
  };
}

/**
 * Build a full quote for a subscription.
 * @param {{ planId: string }} opts
 */
export function buildSubscriptionQuote({ planId }) {
  const plan = calcPlanCostPerInterview(planId);
  return {
    type: 'subscription',
    ...plan,
    breakdown: `${plan.includedInterviews} interviews over ${plan.months} month${plan.months > 1 ? 's' : ''} — only $${plan.costPerInterview}/interview`,
  };
}
