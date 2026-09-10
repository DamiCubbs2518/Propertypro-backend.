const express = require('express');
const router = express.Router();
const pool = require('../db');

// GET all agents
router.get('/', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM agents ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET commission tracker (agent + property + amount owed + remitted status)
// This is exactly what the "Commission tracker" table on the Agents screen needs.
router.get('/commissions', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT c.id, a.name AS agent_name, p.name AS property_name, p.currency,
             a.commission_rate, c.amount_owed, c.is_remitted, c.remitted_at
      FROM commissions c
      JOIN agents a ON a.id = c.agent_id
      JOIN payments pay ON pay.id = c.payment_id
      JOIN tenants t ON t.id = pay.tenant_id
      JOIN properties p ON p.id = t.property_id
      ORDER BY c.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST create a new agent
router.post('/', async (req, res) => {
  try {
    const { name, email, phone, commission_rate } = req.body;
    const result = await pool.query(
      `INSERT INTO agents (name, email, phone, commission_rate)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [name, email, phone, commission_rate || 10.0]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT toggle a commission's remitted checkbox — owner-only in the UI
router.put('/commissions/:id/remit', async (req, res) => {
  try {
    const { is_remitted } = req.body;
    const result = await pool.query(
      `UPDATE commissions SET is_remitted=$1, remitted_at=CASE WHEN $1 THEN now() ELSE NULL END
       WHERE id=$2 RETURNING *`,
      [is_remitted, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Commission not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
