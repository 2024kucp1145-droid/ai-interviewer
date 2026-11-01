/**
 * Pricing Engine — AI Interviewer Platform
 *
 * Structure:
 *  1. Pay-Per-Interview  : priced by duration (10–60 min, $0.50 increments)
 *  2. Bulk Packs         : every 10 interviews → 1 free
 *  3. Subscription Plans : monthly/multi-month with included interview quotas
 */

// ─── 1. PER-INTERVIEW DURATION PRICING ───────────────────────────────────────
export const DURATION_TIERS = [
  { minutes: 10,  priceUsd: 1.00, label: '10 min' },
  { minutes: 20,  priceUsd: 1.50, label: '20 min' },
  { minutes: 30,  priceUsd: 2.00, label: '30 min' },
  { minutes: 40,  priceUsd: 2.50, label: '40 min' },
  { minutes: 50,  priceUsd: 3.00, label: '50 min' },
  { minutes: 60,  priceUsd: 3.50, label: '60 min' },
];

/**
 * Get price per interview for a given duration.
 * @param {number} minutes - Duration in minutes (10–60)
 * @returns {{ priceUsd: number, label: string }}
 */
export function getPriceForDuration(minutes) {
  const tier = DURATION_TIERS.find(t => t.minutes === Number(minutes));
  if (!tier) throw new Error(`Invalid duration: ${minutes}. Must be 10, 20, 30, 40, 50, or 60.`);
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
    priceUsd: 100,
    includedInterviews: 150,
    savingsLabel: null,
    popular: false,
  },
  {
    id: 'monthly_2',
    label: '2 Months',
    months: 2,
    priceUsd: 160,
    includedInterviews: 280,
    savingsLabel: 'Save $40 vs monthly',
    popular: false,
  },
  {
    id: 'quarterly',
    label: '3 Months',
    months: 3,
    priceUsd: 220,
    includedInterviews: 420,
    savingsLabel: 'Save $80 vs monthly',
    popular: false,
  },
  {
    id: 'biannual',
    label: '6 Months',
    months: 6,
    priceUsd: 450,
    includedInterviews: 900,
    savingsLabel: 'Save $150 vs monthly',
    popular: true,
  },
  {
    id: 'annual',
    label: '1 Year',
    months: 12,
    priceUsd: 800,
    includedInterviews: 1800,
    savingsLabel: 'Save $400 vs monthly',
    popular: false,
  },
];

/**
 * Get a subscription plan by ID.
 * @param {string} planId
 */
export function getPlan(planId) {
  const plan = SUBSCRIPTION_PLANS.find(p => p.id === planId);
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
