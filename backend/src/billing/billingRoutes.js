/**
 * Billing Routes — /billing/*
 * Handles: pricing info, quote generation, order creation, subscription management
 */

import express from 'express';
import crypto from 'crypto';
import { db } from '../db/database.js';
import { requireAuth } from '../auth/auth.js';
import {
  DURATION_TIERS,
  SUBSCRIPTION_PLANS,
  buildPayPerUseQuote,
  buildSubscriptionQuote,
  getPlan,
} from './pricing.js';

export const billingRouter = express.Router();

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
// Create a pending order (auth required)
billingRouter.post('/order', requireAuth, (req, res) => {
  try {
    const { type, quantity, minutes, planId } = req.body;
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
      quote.totalUsd || quote.priceUsd,
      JSON.stringify(quote)
    );

    res.json({
      orderId,
      quote,
      // In production this would return a Stripe PaymentIntent / checkout URL
      // For now, return a mock payment URL
      checkoutUrl: `/billing/checkout?order=${orderId}`,
      message: 'Order created. Proceed to checkout to complete payment.',
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ─── POST /billing/order/:id/confirm ─────────────────────────────────────────
// Confirm/complete an order (mock payment — in prod this is a Stripe webhook)
billingRouter.post('/order/:id/confirm', requireAuth, (req, res) => {
  try {
    const orderId = req.params.id;
    const orgId = req.user.org_id;

    const order = db.prepare('SELECT * FROM billing_orders WHERE id = ? AND org_id = ?').get(orderId, orgId);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.status === 'paid') return res.status(400).json({ error: 'Order already paid' });

    const quote = JSON.parse(order.quote_json);

    // Update order to paid
    db.prepare('UPDATE billing_orders SET status = ?, paid_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run('paid', orderId);

    // Credit the organization
    if (order.type === 'pay_per_use') {
      db.prepare('UPDATE organizations SET included_interviews = included_interviews + ? WHERE id = ?')
        .run(quote.quantity, orgId);

    } else if (order.type === 'subscription') {
      const plan = getPlan(order.plan_id);
      const expiresAt = new Date();
      expiresAt.setMonth(expiresAt.getMonth() + plan.months);

      db.prepare(`
        UPDATE organizations
        SET plan = ?, included_interviews = included_interviews + ?,
            subscription_expires_at = ?, subscription_plan_id = ?
        WHERE id = ?
      `).run(plan.id, plan.includedInterviews, expiresAt.toISOString(), plan.id, orgId);
    }

    // Log billing event
    db.prepare(`
      INSERT INTO billing_events (id, org_id, order_id, event, amount_usd, created_at)
      VALUES (?, ?, ?, 'payment_confirmed', ?, CURRENT_TIMESTAMP)
    `).run('be_' + crypto.randomUUID(), orgId, orderId, order.amount_usd);

    // Fetch updated org
    const org = db.prepare('SELECT plan, included_interviews, subscription_expires_at FROM organizations WHERE id = ?').get(orgId);

    res.json({
      success: true,
      message: 'Payment confirmed! Interviews credited to your account.',
      creditsRemaining: org.included_interviews,
      plan: org.plan,
      subscriptionExpiresAt: org.subscription_expires_at || null,
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
