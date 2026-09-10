const express = require('express');
const router = express.Router();
const pool = require('../db');

// GET all shortlet units (with property name joined in)
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT s.*, p.name AS property_name, p.city, p.currency
      FROM shortlet_units s
      JOIN properties p ON p.id = s.property_id
      ORDER BY s.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST create a new shortlet listing
router.post('/', async (req, res) => {
  try {
    const { property_id, name, nightly_rate, max_guests, listing_expires_on } = req.body;
    const result = await pool.query(
      `INSERT INTO shortlet_units (property_id, name, nightly_rate, max_guests, listing_expires_on)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [property_id, name, nightly_rate, max_guests || 2, listing_expires_on || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT toggle availability
router.put('/:id/availability', async (req, res) => {
  try {
    const { is_available } = req.body;
    const result = await pool.query(
      'UPDATE shortlet_units SET is_available=$1 WHERE id=$2 RETURNING *',
      [is_available, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Listing not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
