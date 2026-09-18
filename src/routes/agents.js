const express = require('express');
const router = express.Router();
const pool = require('../db');

// Shapes a raw row into exactly what the frontend's AgentItem expects
function toAgentItem(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    specialty: row.specialty || '',
    assignedPropertiesCount: parseInt(row.assigned_properties_count, 10) || 0,
    managedTenantsCount: parseInt(row.managed_tenants_count, 10) || 0,
    totalLeaseVolume: parseFloat(row.total_lease_volume) || 0,
    unremittedCommission: parseFloat(row.unremitted_commission) || 0,
    remittedCommission: parseFloat(row.remitted_commission) || 0,
    status: row.status,
  };
}

// GET all agents — matches agentService.getAgents()
// Uses scalar subqueries (not joins) so counts/sums never double up.
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        a.*,
        (SELECT COUNT(*) FROM properties p WHERE p.agent_id = a.id) AS assigned_properties_count,
        (SELECT COUNT(*) FROM tenants t
           JOIN properties p ON p.id = t.property_id
           WHERE p.agent_id = a.id) AS managed_tenants_count,
        (SELECT COALESCE(SUM(t.rent_amount), 0) FROM tenants t
           JOIN properties p ON p.id = t.property_id
           WHERE p.agent_id = a.id) AS total_lease_volume,
        (SELECT COALESCE(SUM(c.amount_owed), 0) FROM commissions c
           WHERE c.agent_id = a.id AND c.is_remitted = false) AS unremitted_commission,
        (SELECT COALESCE(SUM(c.amount_owed), 0) FROM commissions c
           WHERE c.agent_id = a.id AND c.is_remitted = true) AS remitted_commission
      FROM agents a
      ORDER BY a.created_at DESC
    `);
    res.json(result.rows.map(toAgentItem));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET commission tracker (used by the Agents screen's commission table)
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
    const { name, email, phone, specialty, commission_rate, status } = req.body;
    const result = await pool.query(
      `INSERT INTO agents (name, email, phone, specialty, commission_rate, status)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [name, email, phone, specialty || null, commission_rate || 10.0, status || 'Active']
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT toggle a commission's remitted checkbox
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
