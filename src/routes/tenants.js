const express = require('express');
const router = express.Router();
const pool = require('../db');

const STATUS_MAP = { pending: 'Pending', paid: 'Paid', overdue: 'Overdue' };

function toPaymentRecord(row) {
  return {
    id: row.id,
    tenantName: row.name,
    tenantEmail: row.email,
    property: row.property_name,
    unit: row.property_name,
    amount: parseFloat(row.amount_due) || 0,
    status: STATUS_MAP[row.payment_status] || 'Pending',
    date: row.payment_created_at,
    dueDate: row.period_end,
    receiptNumber: row.receipt_number || undefined,
    agentId: row.agent_id || undefined,
    agentName: row.agent_name || undefined,
    agentCommissionAmount: row.commission_amount ? parseFloat(row.commission_amount) : undefined,
    agentCommissionRemitted: row.commission_remitted ?? undefined,
    multiYearEligible: row.multi_year_eligible,
    amountOwed: parseFloat(row.amount_due) || 0,
    amountPaid: parseFloat(row.amount_paid) || 0,
    leasePeriod: row.lease_period_label || '',
    phone: row.phone,
    misconductStrikes: row.misconduct_strikes || [],
  };
}

const BASE_QUERY = `
  SELECT
    t.*,
    p.name AS property_name,
    p.currency,
    p.agent_id,
    ag.name AS agent_name,
    latest_pay.id AS payment_id,
    latest_pay.amount_due,
    latest_pay.amount_paid,
    latest_pay.status AS payment_status,
    latest_pay.period_end,
    latest_pay.lease_period_label,
    latest_pay.receipt_number,
    latest_pay.created_at AS payment_created_at,
    comm.amount_owed AS commission_amount,
    comm.is_remitted AS commission_remitted,
    COALESCE(misconducts.strikes, '[]'::json) AS misconduct_strikes
  FROM tenants t
  JOIN properties p ON p.id = t.property_id
  LEFT JOIN agents ag ON ag.id = p.agent_id
  LEFT JOIN LATERAL (
    SELECT * FROM payments WHERE tenant_id = t.id ORDER BY period_start DESC LIMIT 1
  ) latest_pay ON true
  LEFT JOIN commissions comm ON comm.payment_id = latest_pay.id
  LEFT JOIN LATERAL (
    SELECT json_agg(json_build_object(
      'id', id, 'tenantId', tenant_id, 'date', occurred_at, 'offenseTitle', offense_title,
      'description', description, 'penaltyAmount', penalty_amount, 'proofImageUrl', proof_image_url
    )) AS strikes
    FROM misconduct_records WHERE tenant_id = t.id
  ) misconducts ON true
`;

router.get('/', async (req, res) => {
  try {
    const result = await pool.query(`${BASE_QUERY} ORDER BY t.created_at DESC`);
    res.json(result.rows.map(toPaymentRecord));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/by-agent/:agentId', async (req, res) => {
  try {
    const result = await pool.query(
      `${BASE_QUERY} WHERE p.agent_id = $1 ORDER BY t.created_at DESC`,
      [req.params.agentId]
    );
    res.json(result.rows.map(toPaymentRecord));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query(`${BASE_QUERY} WHERE t.id = $1`, [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Tenant not found' });
    res.json(toPaymentRecord(result.rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/link/:token', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT t.id, t.name, t.rent_amount, t.rent_cycle, p.name AS property_name, p.city, p.currency
       FROM tenants t JOIN properties p ON p.id = t.property_id
       WHERE t.payment_link_token = $1`,
      [req.params.token]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Invalid payment link' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { property_id, name, email, phone, rent_amount, rent_cycle, multi_year_eligible } = req.body;
    const result = await pool.query(
      `INSERT INTO tenants (property_id, name, email, phone, rent_amount, rent_cycle, multi_year_eligible)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [property_id, name, email, phone, rent_amount, rent_cycle || 'monthly', multi_year_eligible || false]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { name, email, phone, rent_amount, rent_cycle } = req.body;
    const result = await pool.query(
      `UPDATE tenants SET name=$1, email=$2, phone=$3, rent_amount=$4, rent_cycle=$5
       WHERE id=$6 RETURNING *`,
      [name, email, phone, rent_amount, rent_cycle, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Tenant not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/:id/misconduct', async (req, res) => {
  try {
    const { offenseTitle, description, penaltyAmount, proofImageUrl, date } = req.body;
    const result = await pool.query(
      `INSERT INTO misconduct_records (tenant_id, offense_title, description, penalty_amount, proof_image_url, occurred_at)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6, CURRENT_DATE)) RETURNING *`,
      [req.params.id, offenseTitle, description, penaltyAmount || null, proofImageUrl || null, date || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/:id/remit-commission', async (req, res) => {
  try {
    const result = await pool.query(`
      UPDATE commissions SET is_remitted = true, remitted_at = now()
      WHERE payment_id = (
        SELECT id FROM payments WHERE tenant_id = $1 ORDER BY period_start DESC LIMIT 1
      )
      RETURNING *
    `, [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'No commission found for this tenant' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/:id/multi-year', async (req, res) => {
  try {
    const { isEligible } = req.body;
    const result = await pool.query(
      `UPDATE tenants SET multi_year_eligible = $1 WHERE id = $2 RETURNING *`,
      [isEligible, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Tenant not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM tenants WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Tenant not found' });
    res.json({ deleted: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
