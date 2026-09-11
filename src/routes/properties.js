const express = require('express');
const router = express.Router();
const pool = require('../db');

// Shapes a raw DB row into exactly what the frontend's PropertyItem expects
function toPropertyItem(row) {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    location: `${row.address}, ${row.city}`,
    units: row.units,
    occupiedUnits: row.occupied_units,
    monthlyRevenue: parseFloat(row.monthly_revenue || 0),
    assignedAgent: row.agent_name || '',
    assignedAgentId: row.agent_id || '',
    status: row.status,
  };
}

// GET all properties — matches propertyService.getProperties()
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT p.*, a.name AS agent_name,
        COALESCE((
          SELECT SUM(t.rent_amount) FROM tenants t WHERE t.property_id = p.id
        ), 0) AS monthly_revenue
      FROM properties p
      LEFT JOIN agents a ON a.id = p.agent_id
      ORDER BY p.created_at DESC
    `);
    res.json(result.rows.map(toPropertyItem));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET one property — matches propertyService.getPropertyById()
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT p.*, a.name AS agent_name,
        COALESCE((
          SELECT SUM(t.rent_amount) FROM tenants t WHERE t.property_id = p.id
        ), 0) AS monthly_revenue
      FROM properties p
      LEFT JOIN agents a ON a.id = p.agent_id
      WHERE p.id = $1
    `, [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Property not found' });
    res.json(toPropertyItem(result.rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST create a property
router.post('/', async (req, res) => {
  try {
    const { name, address, city, country, currency, type, units, agent_id } = req.body;
    const result = await pool.query(
      `INSERT INTO properties (name, address, city, country, currency, type, units, agent_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [name, address, city, country || 'Nigeria', currency || 'NGN', type || 'Residential', units || 1, agent_id || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT update a property
router.put('/:id', async (req, res) => {
  try {
    const { name, address, city, country, currency, type, units, occupied_units, status, agent_id } = req.body;
    const result = await pool.query(
      `UPDATE properties SET name=$1, address=$2, city=$3, country=$4, currency=$5,
       type=$6, units=$7, occupied_units=$8, status=$9, agent_id=$10
       WHERE id=$11 RETURNING *`,
      [name, address, city, country, currency, type, units, occupied_units, status, agent_id, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Property not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE a property
router.delete('/:id', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM properties WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Property not found' });
    res.json({ deleted: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
