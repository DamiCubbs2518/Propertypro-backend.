const express = require('express');
const router = express.Router();
const pool = require('../db');

// GET all payments (with tenant + property joined in — powers the dashboard table)
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT pay.*, t.name AS tenant_name, p.name AS property_name, p.currency
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

// POST create a new payment record (e.g. when a new rent period opens)
router.post('/', async (req, res) => {
  try {
    const { tenant_id, amount_due, period_start, period_end } = req.body;
    const result = await pool.query(
      `INSERT INTO payments (tenant_id, amount_due, period_start, period_end)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [tenant_id, amount_due, period_start, period_end]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST mark a payment as paid (this is what the Paystack webhook will call later)
// Also auto-creates the agent's commission row, if the property has an agent.
router.post('/:id/mark-paid', async (req, res) => {
  const client = await pool.connect();
  try {
    const { amount_paid, paystack_ref } = req.body;
    await client.query('BEGIN');

    const paymentResult = await client.query(
      `UPDATE payments SET amount_paid=$1, status='paid', paystack_ref=$2, paid_at=now()
       WHERE id=$3 RETURNING *`,
      [amount_paid, paystack_ref, req.params.id]
    );
    if (paymentResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Payment not found' });
    }
    const payment = paymentResult.rows[0];

    // Find the agent (if any) tied to this tenant's property
    const agentResult = await client.query(
      `SELECT a.id AS agent_id, a.commission_rate
       FROM tenants t
       JOIN properties p ON p.id = t.property_id
       JOIN agents a ON a.id = p.agent_id
       WHERE t.id = $1`,
      [payment.tenant_id]
    );

    if (agentResult.rows.length > 0) {
      const { agent_id, commission_rate } = agentResult.rows[0];
      const commissionAmount = (parseFloat(amount_paid) * parseFloat(commission_rate)) / 100;
      await client.query(
        `INSERT INTO commissions (payment_id, agent_id, amount_owed) VALUES ($1, $2, $3)`,
        [payment.id, agent_id, commissionAmount]
      );
    }

    await client.query('COMMIT');
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
