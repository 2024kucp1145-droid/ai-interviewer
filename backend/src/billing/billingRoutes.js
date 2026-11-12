/**
 * Billing Routes — /billing/*
 * Handles: pricing info, quote generation, order creation, subscription management
 */

import express from 'express';
import crypto from 'crypto';
import { db } from '../db/database.js';
import { requireAuth } from '../auth/auth.js';
import { logActivity } from '../services/activityService.js';
import {
  DURATION_TIERS,
  SUBSCRIPTION_PLANS,
  buildPayPerUseQuote,
  buildSubscriptionQuote,
  getPlan,
} from './pricing.js';

export const billingRouter = express.Router();

/**
 * Idempotently fulfill a paid billing order and credit the organization.
 * @param {string} orderId
 * @param {object} [opts]
 */
export function fulfillPaidOrder(orderId, { provider = 'demo', externalRef = null, actor = null, ipAddress = null } = {}) {
  return db.transaction(() => {
    const order = db.prepare('SELECT * FROM billing_orders WHERE id = ?').get(orderId);
    if (!order) return { ok: false, status: 404, error: 'Order not found' };
    if (order.status === 'paid') {
      const orgAlready = db.prepare('SELECT plan, included_interviews, subscription_expires_at FROM organizations WHERE id = ?').get(order.org_id);
      return { ok: true, alreadyPaid: true, order, org: orgAlready };
    }

    const quote = JSON.parse(order.quote_json);
    const updated = db.prepare("UPDATE billing_orders SET status = 'paid', paid_at = CURRENT_TIMESTAMP WHERE id = ? AND status != 'paid'").run(orderId);
    if (updated.changes === 0) {
      const orgAlready = db.prepare('SELECT plan, included_interviews, subscription_expires_at FROM organizations WHERE id = ?').get(order.org_id);
      return { ok: true, alreadyPaid: true, order, org: orgAlready };
    }

    if (order.type === 'pay_per_use') {
      db.prepare('UPDATE organizations SET included_interviews = included_interviews + ? WHERE id = ?')
        .run(quote.quantity, order.org_id);
    } else if (order.type === 'subscription') {
      const plan = getPlan(order.plan_id);
      const expiresAt = new Date();
      expiresAt.setMonth(expiresAt.getMonth() + plan.months);

      db.prepare(`
        UPDATE organizations
        SET plan = ?, included_interviews = included_interviews + ?,
            subscription_expires_at = ?, subscription_plan_id = ?
        WHERE id = ?
      `).run(plan.id, plan.includedInterviews, expiresAt.toISOString(), plan.id, order.org_id);
    }

    db.prepare(`
      INSERT INTO billing_events (id, org_id, order_id, event, amount_usd, created_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run('be_' + crypto.randomUUID(), order.org_id, orderId, `payment_confirmed:${provider}`, order.amount_usd);

    const creditsAdded = order.type === 'pay_per_use' ? quote.quantity : (getPlan(order.plan_id)?.includedInterviews || 0);
    logActivity({
      action: 'BILLING_PURCHASE',
      actorType: actor ? 'user' : 'webhook',
      actorId: actor?.id || null,
      actorEmail: actor?.email || null,
      actorName: actor?.full_name || actor?.email || `${provider}_webhook`,
      orgId: order.org_id,
      entityType: 'billing_order',
      entityId: orderId,
      details: {
        type: order.type,
        amountUsd: order.amount_usd,
        creditsAdded,
        plan: order.type === 'subscription' ? order.plan_id : null,
        provider,
        externalRef,
      },
      ipAddress,
    });

    const org = db.prepare('SELECT plan, included_interviews, subscription_expires_at FROM organizations WHERE id = ?').get(order.org_id);
    return { ok: true, alreadyPaid: false, order, org, creditsAdded };
  })();
}

/**
 * Verify Stripe-style `t=<ts>,v1=<hex>` webhook signature.
 */
function verifyStripeSignature(rawBody, sigHeader, secret) {
  if (!sigHeader || !secret || typeof sigHeader !== 'string') return false;
  const pairs = Object.fromEntries(
    sigHeader.split(',').map((part) => {
      const i = part.indexOf('=');
      return i > 0 ? [part.slice(0, i).trim(), part.slice(i + 1).trim()] : ['', ''];
    })
  );
  if (!pairs.t || !pairs.v1) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${pairs.t}.${rawBody}`).digest('hex');
  if (expected.length !== pairs.v1.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(pairs.v1, 'utf8'));
}

/**
 * Verify hex HMAC-SHA256 signature (used by Razorpay webhooks).
 */
function verifyHmacHex(rawBody, sigHex, secret) {
  if (!sigHex || !secret || typeof sigHex !== 'string') return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  if (expected.length !== sigHex.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(sigHex, 'utf8'));
}

async function createStripeCheckoutSession({ orderId, quote, amountUsd, baseUrl }) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  const params = new URLSearchParams();
  params.set('mode', 'payment');
  params.set('success_url', `${baseUrl}/billing/checkout?order=${orderId}&status=success`);
  params.set('cancel_url', `${baseUrl}/billing/checkout?order=${orderId}&status=cancelled`);
  params.set('client_reference_id', orderId);
  params.set('metadata[orderId]', orderId);
  params.set('line_items[0][quantity]', '1');
  params.set('line_items[0][price_data][currency]', 'usd');
  params.set('line_items[0][price_data][unit_amount]', String(Math.round(Number(amountUsd) * 100)));
  params.set('line_items[0][price_data][product_data][name]', quote.label || `RoundOne AI Credits (${orderId})`);

  const resp = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error?.message || 'Stripe session creation failed');
  return { provider: 'stripe', sessionId: data.id, checkoutUrl: data.url };
}

async function createRazorpayOrder({ orderId, amountUsd }) {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) return null;
  const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
  const resp = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      amount: Math.round(Number(amountUsd) * 100),
      currency: 'USD',
      receipt: orderId,
      notes: { orderId },
    }),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error?.description || 'Razorpay order creation failed');
  return { provider: 'razorpay', razorpayOrderId: data.id, keyId };
}

// ─── GET /billing/pricing ─────────────────────────────────────────────────────
// Returns all pricing data for the frontend pricing page (no auth required)
billingRouter.get('/pricing', (req, res) => {
  res.json({
    durationTiers: DURATION_TIERS,
    subscriptionPlans: SUBSCRIPTION_PLANS.map(p => ({
      ...p,
      costPerInterview: +(p.priceUsd / p.includedInterviews).toFixed(3),
    })),
    bulkRule: {
      description: 'Buy 10 interviews → get 1 FREE. Applies to every multiple of 10.',
      example: 'Buy 20 → pay for 18. Buy 30 → pay for 27.',
    },
  });
});

// ─── POST /billing/quote ──────────────────────────────────────────────────────
// Generate a pricing quote (no auth required, used in checkout flow)
billingRouter.post('/quote', (req, res) => {
  try {
    const { type, quantity, minutes, planId } = req.body;

    if (type === 'pay_per_use') {
      if (!quantity || !minutes) {
        return res.status(400).json({ error: 'quantity and minutes are required for pay_per_use' });
      }
      const quote = buildPayPerUseQuote({ quantity: Number(quantity), minutes: Number(minutes) });
      return res.json(quote);
    }

    if (type === 'subscription') {
      if (!planId) {
        return res.status(400).json({ error: 'planId is required for subscription' });
      }
      const quote = buildSubscriptionQuote({ planId });
      return res.json(quote);
    }

    return res.status(400).json({ error: 'type must be "pay_per_use" or "subscription"' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ─── POST /billing/order ──────────────────────────────────────────────────────
// Create a pending order (auth required; uses Stripe/Razorpay when configured, else demo checkout)
billingRouter.post('/order', requireAuth, async (req, res) => {
  try {
    const { type, quantity, minutes, planId, gateway } = req.body;
    const orgId = req.user.org_id;

    let quote;
    if (type === 'pay_per_use') {
      quote = buildPayPerUseQuote({ quantity: Number(quantity), minutes: Number(minutes) });
    } else if (type === 'subscription') {
      quote = buildSubscriptionQuote({ planId });
    } else {
      return res.status(400).json({ error: 'Invalid order type' });
    }

    const orderId = 'ord_' + crypto.randomUUID();
    const amountUsd = quote.totalUsd || quote.priceUsd;

    // Store order in DB
    db.prepare(`
      INSERT INTO billing_orders
        (id, org_id, type, plan_id, quantity, duration_minutes, amount_usd, status, quote_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, CURRENT_TIMESTAMP)
    `).run(
      orderId,
      orgId,
      type,
      planId || null,
      quote.quantity || null,
      quote.durationMinutes || null,
      amountUsd,
      JSON.stringify(quote)
    );

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    let providerSession = null;
    if (gateway === 'razorpay' && process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
      providerSession = await createRazorpayOrder({ orderId, amountUsd });
    } else if (process.env.STRIPE_SECRET_KEY && gateway !== 'demo') {
      providerSession = await createStripeCheckoutSession({ orderId, quote, amountUsd, baseUrl });
    }

    res.json({
      orderId,
      quote,
      provider: providerSession?.provider || 'demo',
      providerSession,
      checkoutUrl: providerSession?.checkoutUrl || `/billing/checkout?order=${orderId}`,
      message: 'Order created. Proceed to checkout to complete payment.',
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ─── POST /billing/order/:id/confirm ─────────────────────────────────────────
// Confirm/complete an order (demo checkout confirmation when webhooks are not active)
billingRouter.post('/order/:id/confirm', requireAuth, (req, res) => {
  try {
    const orderId = req.params.id;
    const orgId = req.user.org_id;

    const existing = db.prepare('SELECT id, status FROM billing_orders WHERE id = ? AND org_id = ?').get(orderId, orgId);
    if (!existing) return res.status(404).json({ error: 'Order not found' });
    if (existing.status === 'paid') return res.status(400).json({ error: 'Order already paid' });

    const result = fulfillPaidOrder(orderId, {
      provider: 'demo',
      actor: req.user,
      ipAddress: req.ip,
    });

    res.json({
      success: true,
      message: 'Payment confirmed! Interviews credited to your account.',
      creditsRemaining: result.org.included_interviews,
      plan: result.org.plan,
      subscriptionExpiresAt: result.org.subscription_expires_at || null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /billing/balance ─────────────────────────────────────────────────────
// Get current org's interview credits & subscription status
billingRouter.get('/balance', requireAuth, (req, res) => {
  try {
    const orgId = req.user.org_id;
    const org = db.prepare(`
      SELECT plan, included_interviews, subscription_expires_at, subscription_plan_id
      FROM organizations WHERE id = ?
    `).get(orgId);

    const recentOrders = db.prepare(`
      SELECT id, type, plan_id, quantity, duration_minutes, amount_usd, status, paid_at, created_at
      FROM billing_orders WHERE org_id = ? ORDER BY created_at DESC LIMIT 20
    `).all(orgId);

    let subscriptionPlan = null;
    if (org.subscription_plan_id) {
      subscriptionPlan = SUBSCRIPTION_PLANS.find(p => p.id === org.subscription_plan_id) || null;
    }

    res.json({
      creditsRemaining: org.included_interviews,
      plan: org.plan,
      subscriptionExpiresAt: org.subscription_expires_at,
      subscriptionPlan,
      recentOrders,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /billing/history ─────────────────────────────────────────────────────
// Full billing history
billingRouter.get('/history', requireAuth, (req, res) => {
  try {
    const orgId = req.user.org_id;
    const orders = db.prepare(`
      SELECT id, type, plan_id, quantity, duration_minutes, amount_usd, status, paid_at, created_at, quote_json
      FROM billing_orders WHERE org_id = ? ORDER BY created_at DESC
    `).all(orgId);

    const events = db.prepare(`
      SELECT id, order_id, event, amount_usd, created_at
      FROM billing_events WHERE org_id = ? ORDER BY created_at DESC LIMIT 50
    `).all(orgId);

    res.json({ orders, events });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /billing/webhook/stripe ─────────────────────────────────────────────
// Signed Stripe webhook handler (checkout.session.completed)
billingRouter.post('/webhook/stripe', (req, res) => {
  try {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) {
      return res.status(503).json({ error: 'STRIPE_WEBHOOK_SECRET is not configured on this server.' });
    }
    const rawBody = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body || {});
    const sig = req.headers['stripe-signature'];
    if (!verifyStripeSignature(rawBody, sig, secret)) {
      return res.status(400).json({ error: 'Invalid Stripe webhook signature.' });
    }

    const event = req.body || {};
    if (event.type === 'checkout.session.completed' || event.type === 'payment_intent.succeeded') {
      const obj = event.data?.object || {};
      const orderId = obj.metadata?.orderId || obj.client_reference_id;
      if (!orderId) return res.status(400).json({ error: 'Missing orderId metadata in Stripe event.' });

      const result = fulfillPaidOrder(orderId, {
        provider: 'stripe',
        externalRef: obj.id || event.id,
        ipAddress: req.ip,
      });
      if (!result.ok) return res.status(result.status || 404).json({ error: result.error });
      return res.json({ received: true, fulfilled: !result.alreadyPaid, orderId });
    }

    res.json({ received: true, ignored: true, type: event.type || 'unknown' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /billing/webhook/razorpay ───────────────────────────────────────────
// Signed Razorpay webhook handler (payment.captured / order.paid)
billingRouter.post('/webhook/razorpay', (req, res) => {
  try {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!secret) {
      return res.status(503).json({ error: 'RAZORPAY_WEBHOOK_SECRET is not configured on this server.' });
    }
    const rawBody = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body || {});
    const sig = req.headers['x-razorpay-signature'];
    if (!verifyHmacHex(rawBody, sig, secret)) {
      return res.status(400).json({ error: 'Invalid Razorpay webhook signature.' });
    }

    const event = req.body || {};
    if (event.event === 'payment.captured' || event.event === 'order.paid') {
      const paymentEntity = event.payload?.payment?.entity || {};
      const orderEntity = event.payload?.order?.entity || {};
      const orderId = orderEntity.receipt || paymentEntity.notes?.orderId || orderEntity.notes?.orderId;
      if (!orderId) return res.status(400).json({ error: 'Missing orderId in Razorpay payload.' });

      const result = fulfillPaidOrder(orderId, {
        provider: 'razorpay',
        externalRef: paymentEntity.id || orderEntity.id,
        ipAddress: req.ip,
      });
      if (!result.ok) return res.status(result.status || 404).json({ error: result.error });
      return res.json({ received: true, fulfilled: !result.alreadyPaid, orderId });
    }

    res.json({ received: true, ignored: true, event: event.event || 'unknown' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
