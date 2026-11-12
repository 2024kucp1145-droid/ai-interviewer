/**
 * Billing Routes — /billing/*
 * Handles: pricing info, quote generation, order creation, subscription management
 */

import express from 'express';
import crypto from 'crypto';
import Stripe from 'stripe';
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

function getStripeClient() {
  const key = process.env.STRIPE_SECRET_KEY;
  return key ? new Stripe(key) : null;
}

async function ensureStripeCustomer(stripe, orgId, actorEmail) {
  const org = db.prepare('SELECT id, name, stripe_customer_id FROM organizations WHERE id = ?').get(orgId);
  if (!org) throw new Error('Organization not found');
  if (org.stripe_customer_id) return org.stripe_customer_id;

  const customer = await stripe.customers.create({
    name: org.name || 'RoundOne AI Customer',
    email: actorEmail || undefined,
    metadata: { orgId },
  });
  db.prepare('UPDATE organizations SET stripe_customer_id = ? WHERE id = ?').run(customer.id, orgId);
  return customer.id;
}

async function attachOrderInvoiceDetails(stripe, orderId, invoiceRef) {
  if (!orderId || !invoiceRef) return null;
  let inv = typeof invoiceRef === 'object' ? invoiceRef : null;
  if (!inv && typeof invoiceRef === 'string' && stripe) {
    try { inv = await stripe.invoices.retrieve(invoiceRef); } catch { inv = null; }
  }
  const invoiceId = inv?.id || (typeof invoiceRef === 'string' ? invoiceRef : null);
  const pdfUrl = inv?.invoice_pdf || null;
  const hostedUrl = inv?.hosted_invoice_url || null;
  db.prepare(`
    UPDATE billing_orders
    SET stripe_invoice_id = COALESCE(?, stripe_invoice_id),
        invoice_pdf_url = COALESCE(?, invoice_pdf_url),
        hosted_invoice_url = COALESCE(?, hosted_invoice_url)
    WHERE id = ?
  `).run(invoiceId, pdfUrl, hostedUrl, orderId);
  return { invoiceId, pdfUrl, hostedUrl };
}

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
 * Verify Stripe-style `t=<ts>,v1=<hex>` webhook signature with replay protection.
 */
function verifyStripeSignature(rawBody, sigHeader, secret, toleranceSec = 300) {
  if (!sigHeader || !secret || typeof sigHeader !== 'string') return false;
  const pairs = Object.fromEntries(
    sigHeader.split(',').map((part) => {
      const i = part.indexOf('=');
      return i > 0 ? [part.slice(0, i).trim(), part.slice(i + 1).trim()] : ['', ''];
    })
  );
  const ts = Number(pairs.t);
  if (!Number.isFinite(ts) || !pairs.v1) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - ts) > toleranceSec) return false;

  const expected = crypto.createHmac('sha256', secret).update(`${ts}.${rawBody}`).digest('hex');
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

async function createStripeCheckoutSession({ orderId, type, quote, amountUsd, baseUrl, orgId, user }) {
  const stripe = getStripeClient();
  if (!stripe) return null;

  const customerId = await ensureStripeCustomer(stripe, orgId, user?.email);
  const unitAmount = Math.round(Number(amountUsd) * 100);
  const isSubscription = type === 'subscription';

  const priceData = {
    currency: 'usd',
    unit_amount: unitAmount,
    product_data: {
      name: isSubscription
        ? `RoundOne AI — ${quote.label || 'Subscription'} (${quote.includedInterviews || 0} interviews)`
        : `RoundOne AI — ${quote.breakdown || `Credits (${orderId})`}`,
    },
  };
  if (isSubscription) {
    priceData.recurring = {
      interval: 'month',
      interval_count: Math.max(1, Number(quote.months) || 1),
    };
  }

  const sessionPayload = {
    mode: isSubscription ? 'subscription' : 'payment',
    customer: customerId,
    client_reference_id: orderId,
    success_url: `${baseUrl}/billing/checkout?order=${orderId}&status=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/billing/checkout?order=${orderId}&status=cancelled`,
    metadata: { orderId, orgId, orderType: type },
    line_items: [{ quantity: 1, price_data: priceData }],
  };

  if (isSubscription) {
    sessionPayload.subscription_data = {
      metadata: { orderId, orgId, planId: quote.id || '' },
    };
  } else {
    sessionPayload.invoice_creation = { enabled: true };
  }

  const session = await stripe.checkout.sessions.create(sessionPayload);
  db.prepare('UPDATE billing_orders SET stripe_session_id = ? WHERE id = ?').run(session.id, orderId);
  return { provider: 'stripe', sessionId: session.id, checkoutUrl: session.url };
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
      providerSession = await createStripeCheckoutSession({
        orderId,
        type,
        quote,
        amountUsd,
        baseUrl,
        orgId,
        user: req.user,
      });
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
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({
        error: 'Direct demo confirmation is disabled in production. Complete payment via Stripe Checkout.',
      });
    }
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
      SELECT plan, included_interviews, subscription_expires_at, subscription_plan_id,
             stripe_customer_id, stripe_subscription_id, stripe_subscription_status
      FROM organizations WHERE id = ?
    `).get(orgId);

    const recentOrders = db.prepare(`
      SELECT id, type, plan_id, quantity, duration_minutes, amount_usd, status, paid_at,
             stripe_invoice_id, invoice_pdf_url, hosted_invoice_url, created_at
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
      stripeSubscriptionStatus: org.stripe_subscription_status || null,
      hasStripeCustomer: Boolean(org.stripe_customer_id),
      stripeConfigured: Boolean(process.env.STRIPE_SECRET_KEY),
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
      SELECT id, type, plan_id, quantity, duration_minutes, amount_usd, status, paid_at,
             quote_json, stripe_invoice_id, invoice_pdf_url, hosted_invoice_url, created_at
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

// ─── POST /billing/portal ─────────────────────────────────────────────────────
// Launch Stripe Customer Portal so orgs can manage cards, subscriptions & PDF invoices
billingRouter.post('/portal', requireAuth, async (req, res) => {
  try {
    const stripe = getStripeClient();
    if (!stripe) {
      return res.status(503).json({ error: 'Stripe is not configured on this server yet (STRIPE_SECRET_KEY missing).' });
    }
    const customerId = await ensureStripeCustomer(stripe, req.user.org_id, req.user?.email);
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${baseUrl}/`,
    });
    res.json({ url: portalSession.url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /billing/orders/:id/invoice ──────────────────────────────────────────
// Fetch or hydrate downloadable Stripe PDF invoice & hosted receipt URL
billingRouter.get('/orders/:id/invoice', requireAuth, async (req, res) => {
  try {
    const order = db.prepare('SELECT * FROM billing_orders WHERE id = ? AND org_id = ?').get(req.params.id, req.user.org_id);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    if (order.invoice_pdf_url || order.hosted_invoice_url) {
      return res.json({
        orderId: order.id,
        stripeInvoiceId: order.stripe_invoice_id,
        invoicePdfUrl: order.invoice_pdf_url,
        hostedInvoiceUrl: order.hosted_invoice_url,
      });
    }

    const stripe = getStripeClient();
    if (!stripe) {
      return res.status(404).json({ error: 'No Stripe invoice attached for this order.' });
    }

    let invoiceId = order.stripe_invoice_id;
    if (!invoiceId && order.stripe_session_id) {
      const session = await stripe.checkout.sessions.retrieve(order.stripe_session_id);
      invoiceId = typeof session.invoice === 'string' ? session.invoice : session.invoice?.id;
    }
    if (!invoiceId) {
      return res.status(404).json({ error: 'Invoice is not yet available for this order.' });
    }

    const attached = await attachOrderInvoiceDetails(stripe, order.id, invoiceId);
    res.json({
      orderId: order.id,
      stripeInvoiceId: attached?.invoiceId || invoiceId,
      invoicePdfUrl: attached?.pdfUrl || null,
      hostedInvoiceUrl: attached?.hostedUrl || null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /billing/webhook/stripe ─────────────────────────────────────────────
// Signed Stripe webhook handler (Checkout, Payments, Recurring Subscriptions & Invoices)
billingRouter.post('/webhook/stripe', async (req, res) => {
  try {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) {
      return res.status(503).json({ error: 'STRIPE_WEBHOOK_SECRET is not configured on this server.' });
    }
    const rawBody = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body || {});
    const sig = req.headers['stripe-signature'];
    const stripe = getStripeClient();

    let event = req.body || {};
    if (stripe) {
      try {
        event = stripe.webhooks.constructEvent(rawBody, sig, secret);
      } catch {
        return res.status(400).json({ error: 'Invalid Stripe webhook signature.' });
      }
    } else if (!verifyStripeSignature(rawBody, sig, secret)) {
      return res.status(400).json({ error: 'Invalid Stripe webhook signature.' });
    }

    const obj = event.data?.object || {};

    if (event.type === 'checkout.session.completed') {
      const orderId = obj.metadata?.orderId || obj.client_reference_id;
      if (!orderId) return res.status(400).json({ error: 'Missing orderId metadata in Stripe event.' });

      db.prepare('UPDATE billing_orders SET stripe_session_id = COALESCE(?, stripe_session_id) WHERE id = ?')
        .run(obj.id || null, orderId);

      if (obj.invoice) {
        await attachOrderInvoiceDetails(stripe, orderId, obj.invoice);
      }
      if (obj.subscription && obj.metadata?.orgId) {
        db.prepare(`
          UPDATE organizations
          SET stripe_customer_id = COALESCE(?, stripe_customer_id),
              stripe_subscription_id = ?,
              stripe_subscription_status = 'active'
          WHERE id = ?
        `).run(obj.customer || null, String(obj.subscription), obj.metadata.orgId);
      }

      const result = fulfillPaidOrder(orderId, {
        provider: 'stripe',
        externalRef: obj.id || event.id,
        ipAddress: req.ip,
      });
      if (!result.ok) return res.status(result.status || 404).json({ error: result.error });
      return res.json({ received: true, fulfilled: !result.alreadyPaid, orderId });
    }

    if (event.type === 'payment_intent.succeeded') {
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

    if (event.type === 'invoice.paid' || event.type === 'invoice.payment_succeeded') {
      const invoiceId = obj.id || null;
      const pdfUrl = obj.invoice_pdf || null;
      const hostedUrl = obj.hosted_invoice_url || null;

      if (invoiceId) {
        db.prepare(`
          UPDATE billing_orders
          SET invoice_pdf_url = COALESCE(?, invoice_pdf_url),
              hosted_invoice_url = COALESCE(?, hosted_invoice_url)
          WHERE stripe_invoice_id = ?
        `).run(pdfUrl, hostedUrl, invoiceId);
      }

      const metaOrderId = obj.metadata?.orderId || obj.parent?.subscription_details?.metadata?.orderId;
      if (metaOrderId) {
        await attachOrderInvoiceDetails(stripe, metaOrderId, obj);
      }

      // Auto-renewal cycle: replenish credits & extend subscription period automatically
      if (obj.billing_reason === 'subscription_cycle' && obj.subscription) {
        const subId = String(obj.subscription);
        const alreadyLogged = invoiceId
          ? db.prepare('SELECT id FROM billing_orders WHERE stripe_invoice_id = ?').get(invoiceId)
          : null;
        if (!alreadyLogged) {
          const org = db.prepare('SELECT id, subscription_plan_id FROM organizations WHERE stripe_subscription_id = ?').get(subId);
          if (org && org.subscription_plan_id) {
            const plan = SUBSCRIPTION_PLANS.find((p) => p.id === org.subscription_plan_id);
            if (plan) {
              const renewOrderId = 'ord_ren_' + crypto.randomUUID().slice(0, 12);
              const amountUsd = obj.amount_paid != null ? +(obj.amount_paid / 100).toFixed(2) : plan.priceUsd;
              const quote = buildSubscriptionQuote({ planId: plan.id });

              db.transaction(() => {
                db.prepare(`
                  INSERT INTO billing_orders
                    (id, org_id, type, plan_id, quantity, duration_minutes, amount_usd, status, paid_at, quote_json, stripe_invoice_id, invoice_pdf_url, hosted_invoice_url, created_at)
                  VALUES (?, ?, 'subscription', ?, NULL, NULL, ?, 'paid', CURRENT_TIMESTAMP, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                `).run(renewOrderId, org.id, plan.id, amountUsd, JSON.stringify(quote), invoiceId, pdfUrl, hostedUrl);

                const expiresAt = new Date();
                expiresAt.setMonth(expiresAt.getMonth() + plan.months);
                db.prepare(`
                  UPDATE organizations
                  SET included_interviews = included_interviews + ?,
                      subscription_expires_at = ?,
                      stripe_subscription_status = 'active'
                  WHERE id = ?
                `).run(plan.includedInterviews, expiresAt.toISOString(), org.id);

                db.prepare(`
                  INSERT INTO billing_events (id, org_id, order_id, event, amount_usd, created_at)
                  VALUES (?, ?, ?, 'payment_confirmed:stripe_renewal', ?, CURRENT_TIMESTAMP)
                `).run('be_' + crypto.randomUUID(), org.id, renewOrderId, amountUsd);
              })();

              return res.json({ received: true, renewed: true, orderId: renewOrderId });
            }
          }
        }
      }
      return res.json({ received: true, invoiceRecorded: true });
    }

    if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
      const subId = obj.id;
      const nextStatus = event.type === 'customer.subscription.deleted' ? 'canceled' : (obj.status || 'active');
      if (subId) {
        db.prepare('UPDATE organizations SET stripe_subscription_status = ? WHERE stripe_subscription_id = ?')
          .run(nextStatus, String(subId));
      }
      return res.json({ received: true, subscriptionStatus: nextStatus });
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

// ─── GET /billing/checkout ───────────────────────────────────────────────────
// Clean checkout landing / return page for demo checkout & Stripe success/cancel redirects
billingRouter.get('/checkout', (req, res) => {
  const orderId = String(req.query.order || '').replace(/[^a-zA-Z0-9_-]/g, '');
  const statusParam = String(req.query.status || '').toLowerCase();
  const order = orderId ? db.prepare('SELECT id, type, plan_id, amount_usd, status FROM billing_orders WHERE id = ?').get(orderId) : null;
  const isPaid = order?.status === 'paid' || statusParam === 'success';
  const title = isPaid ? 'Payment Confirmed' : (statusParam === 'cancelled' ? 'Checkout Cancelled' : 'Complete Billing Order');
  const subtitle = isPaid
    ? 'Your RoundOne AI credits and subscription benefits are now active.'
    : (order ? `Order ${order.id} · $${Number(order.amount_usd || 0).toFixed(2)} USD (${order.status})` : 'No active order selected.');

  res.status(200).type('html').send(`<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} — RoundOne AI</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;background:#f8fafc;color:#0f172a;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:1rem;}.card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;max-width:460px;width:100%;padding:2rem;box-shadow:0 10px 25px rgba(15,23,42,.06);text-align:center;}.btn{display:inline-block;margin-top:1.25rem;padding:.65rem 1.25rem;border-radius:8px;background:#0f172a;color:#fff;text-decoration:none;font-weight:600;font-size:.875rem;}</style>
</head><body><div class="card">
<h2 style="margin:0 0 .5rem;">${title}</h2>
<p style="color:#475569;font-size:.9rem;margin:0;">${subtitle}</p>
<a class="btn" href="/#metrics">Return to RoundOne Dashboard</a>
</div></body></html>`);
});
