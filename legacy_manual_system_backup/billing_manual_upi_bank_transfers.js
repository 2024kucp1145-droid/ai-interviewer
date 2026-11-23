/**
 * LEGACY MANUAL BILLING BACKUP
 * Component: Manual UPI QR Generation, UTR Transaction Reference Matching, and Bank Wire Transfers
 * 
 * Original Location: backend/src/billing/billingRoutes.js
 * Purpose: Allows customers to pay via manual UPI QR or direct bank transfer, enter a UTR number,
 * and wait for manual/automated verification.
 */

import express from 'express';
import crypto from 'crypto';
import QRCode from 'qrcode';

export const legacyManualBillingRouter = express.Router();

/**
 * 1. Build Direct UPI Intent Link & Generate QR Code
 * @param {string} upiId - Merchant UPI Virtual Payment Address (e.g. merchant@okhdfcbank)
 * @param {string} upiName - Merchant Business Name
 * @param {number} amountInr - Amount in Indian Rupees
 * @param {string} orderId - Unique internal order identifier
 */
export async function generateManualUpiQr({ upiId, upiName, amountInr, orderId }) {
  if (!upiId) throw new Error('Merchant UPI ID is not configured');
  
  const note = encodeURIComponent(`Order ${orderId.slice(0, 16)}`);
  const upiDeepLink = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(upiName || 'Merchant')}&am=${Number(amountInr).toFixed(2)}&cu=INR&tn=${note}`;
  
  const qrDataUrl = await QRCode.toDataURL(upiDeepLink, {
    width: 250,
    margin: 2,
    color: {
      dark: '#000000',
      light: '#ffffff'
    }
  });

  return {
    upiDeepLink,
    qrDataUrl
  };
}

/**
 * 2. Manual Bank Transfer Instructions Template
 */
export function getManualBankTransferDetails(bankConfig) {
  return {
    accountHolder: bankConfig.accountHolder || 'RoundOne AI Technologies',
    accountNumber: bankConfig.accountNumber || '',
    ifscCode: bankConfig.ifscCode || '',
    bankName: bankConfig.bankName || '',
    branch: bankConfig.branch || '',
    accountType: bankConfig.accountType || 'Current',
    instructions: 'Please transfer via IMPS/NEFT/RTGS and submit the transaction reference (UTR) below.'
  };
}

/**
 * 3. Validate UTR (Unique Transaction Reference) Number
 */
export function validateUtrFormat(rawUtr) {
  const cleanUtr = String(rawUtr || '').trim().replace(/\s+/g, '');
  // Standard Indian banking UTR is alphanumeric between 6 and 40 characters
  const isValid = /^[a-zA-Z0-9_-]{6,40}$/.test(cleanUtr);
  return {
    isValid,
    cleanUtr,
    error: isValid ? null : 'Enter a valid 6–40 character alphanumeric UTR / Transaction Reference ID.'
  };
}

/**
 * 4. Submit UTR Route Handler (Reference implementation)
 */
export function handleUtrSubmission(db, { orderId, rawUtr, paymentMethod = 'upi_direct', autoApprove = false }) {
  const { isValid, cleanUtr, error } = validateUtrFormat(rawUtr);
  if (!isValid) {
    return { success: false, status: 400, error };
  }

  const order = db.prepare('SELECT * FROM billing_orders WHERE id = ?').get(orderId);
  if (!order) {
    return { success: false, status: 404, error: 'Order not found' };
  }

  // Prevent reusing same UTR across multiple orders
  const duplicate = db.prepare("SELECT id FROM billing_orders WHERE utr_number = ? AND id != ? AND status IN ('paid', 'pending_verification')")
    .get(cleanUtr, orderId);
  if (duplicate) {
    return { success: false, status: 400, error: 'This UTR has already been submitted for another order.' };
  }

  if (autoApprove) {
    db.prepare(`
      UPDATE billing_orders 
      SET status = 'paid', utr_number = ?, payment_method = ?, paid_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(cleanUtr, paymentMethod, orderId);
    return { success: true, status: 200, state: 'paid', utrNumber: cleanUtr };
  } else {
    db.prepare(`
      UPDATE billing_orders 
      SET status = 'pending_verification', utr_number = ?, payment_method = ?
      WHERE id = ?
    `).run(cleanUtr, paymentMethod, orderId);
    return { success: true, status: 200, state: 'pending_verification', utrNumber: cleanUtr };
  }
}
