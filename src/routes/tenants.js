const express = require('express');
const router = express.Router();
const pool = require('../db');

// GET all tenants (with property name joined in)
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT t.*, p.name AS property_name, p.city, p.currency
      FROM tenants t
      JOIN properties p ON p.id = t.property_id
      ORDER BY t.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET one tenant by ID (full profile: payments + complaints included)
router.get('/:id', async (req, res) => {
  try {
    const tenant = await pool.query('SELECT * FROM tenants WHERE id = $1', [req.params.id]);
    if (tenant.rows.length === 0) return res.status(404).json({ error: 'Tenant not found' });

    const payments = await pool.query(
      'SELECT * FROM payments WHERE tenant_id = $1 ORDER BY period_start DESC',
      [req.params.id]
    );
    const complaints = await pool.query(
      'SELECT * FROM complaints WHERE tenant_id = $1 ORDER BY created_at DESC',
      [req.params.id]
    );

    res.json({
      ...tenant.rows[0],
      payments: payments.rows,
      complaints: complaints.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET tenant by their public payment link token (used by the tenant payment page)
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

// POST create a new tenant
router.post('/', async (req, res) => {
  try {
    const { property_id, name, email, phone, rent_amount, rent_cycle } = req.body;
    const result = await pool.query(
      `INSERT INTO tenants (property_id, name, email, phone, rent_amount, rent_cycle)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [property_id, name, email, phone, rent_amount, rent_cycle || 'monthly']
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT update a tenant (e.g. editable rent amount)
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

// DELETE a tenant
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
