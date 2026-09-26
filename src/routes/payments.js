const express = require('express');
const router = express.Router();
const pool = require('../db');
const { sendReceiptEmail } = require('../services/email');

// GET all payments (with tenant + property joined in)
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT pay.*, t.name AS tenant_name, t.email AS tenant_email,
             p.name AS property_name, p.currency
      FROM payments pay
      JOIN tenants t ON t.id = pay.tenant_id
      JOIN properties p ON p.id = t.property_id
      ORDER BY pay.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST create a new payment record (opens a rent period)
router.post('/', async (req, res) => {
  try {
    const { tenant_id, amount_due, period_start, period_end, lease_period_label } = req.body;
    const result = await pool.query(
      `INSERT INTO payments (tenant_id, amount_due, period_start, period_end, lease_period_label)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [tenant_id, amount_due, period_start, period_end, lease_period_label || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Shared logic: mark a payment paid + auto-create commission + email a receipt.
// Used by both the verify route below and (optionally) a future webhook.
async function completePayment(client, paymentId, amountPaid, paystackRef) {
  const paymentResult = await client.query(
    `UPDATE payments SET amount_paid=$1, status='paid', paystack_ref=$2, paid_at=now()
     WHERE id=$3 AND status != 'paid' RETURNING *`,
    [amountPaid, paystackRef, paymentId]
  );
  if (paymentResult.rows.length === 0) return null; // already paid or not found — avoid double-processing

  const payment = paymentResult.rows[0];

  // Fetch tenant + property + agent info for commission + receipt email
  const infoResult = await client.query(`
    SELECT t.name AS tenant_name, t.email AS tenant_email,
           p.name AS property_name, p.agent_id, a.commission_rate
    FROM tenants t
    JOIN properties p ON p.id = t.property_id
    LEFT JOIN agents a ON a.id = p.agent_id
    WHERE t.id = $1
  `, [payment.tenant_id]);

  const info = infoResult.rows[0];

  // Auto-create commission if this property has an agent
  if (info?.agent_id) {
    const commissionAmount = (parseFloat(amountPaid) * parseFloat(info.commission_rate)) / 100;
    await client.query(
      `INSERT INTO commissions (payment_id, agent_id, amount_owed) VALUES ($1, $2, $3)`,
      [payment.id, info.agent_id, commissionAmount]
    );
  }

  // Email a receipt (fire-and-forget — don't fail the payment if email fails)
  if (info?.tenant_email) {
    sendReceiptEmail({
      to: info.tenant_email,
      tenantName: info.tenant_name,
      amount: amountPaid,
      propertyName: info.property_name,
      period: payment.lease_period_label || `${payment.period_start} to ${payment.period_end}`,
    });
  }

  return payment;
}

// POST verify a Paystack payment and mark it paid — called by the frontend
// right after the Paystack popup reports success. This is the SOURCE OF
// TRUTH check — never trust the frontend's "success" callback alone.
router.post('/:id/verify-paystack', async (req, res) => {
  const client = await pool.connect();
  try {
    const { reference } = req.body;
    if (!reference) return res.status(400).json({ error: 'Missing payment reference' });

    // Ask Paystack directly: did this payment actually succeed?
    const verifyRes = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
    });
    const verifyData = await verifyRes.json();

    if (!verifyData.status || verifyData.data.status !== 'success') {
      return res.status(400).json({ error: 'Payment could not be verified.' });
    }

    const amountPaid = verifyData.data.amount / 100; // Paystack uses kobo

    await client.query('BEGIN');
    const payment = await completePayment(client, req.params.id, amountPaid, reference);
    await client.query('COMMIT');

    if (!payment) {
      return res.status(409).json({ error: 'This payment was already recorded.' });
    }
    res.json(payment);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// POST manual mark-paid (kept for admin/testing use, same underlying logic)
router.post('/:id/mark-paid', async (req, res) => {
  const client = await pool.connect();
  try {
    const { amount_paid, paystack_ref } = req.body;
    await client.query('BEGIN');
    const payment = await completePayment(client, req.params.id, amount_paid, paystack_ref || 'manual');
    await client.query('COMMIT');

    if (!payment) {
      return res.status(409).json({ error: 'This payment was already recorded.' });
    }
    res.json(payment);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

module.exports = router;
