const express = require('express');
const router = express.Router();
const pool = require('../db');

// GET all properties
router.get('/', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM properties ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET one property by ID
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM properties WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Property not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST create a new property
router.post('/', async (req, res) => {
  try {
    const { name, address, city, country, currency, agent_id } = req.body;
    const result = await pool.query(
      `INSERT INTO properties (name, address, city, country, currency, agent_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [name, address, city, country || 'Nigeria', currency || 'NGN', agent_id || null]
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
    const { name, address, city, country, currency, agent_id } = req.body;
    const result = await pool.query(
      `UPDATE properties SET name=$1, address=$2, city=$3, country=$4, currency=$5, agent_id=$6
       WHERE id=$7 RETURNING *`,
      [name, address, city, country, currency, agent_id, req.params.id]
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
