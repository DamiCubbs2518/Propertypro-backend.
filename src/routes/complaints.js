const express = require('express');
const router = express.Router();
const pool = require('../db');

// GET all complaints (optionally filter by tenant_id via query string)
router.get('/', async (req, res) => {
  try {
    const { tenant_id } = req.query;
    const result = tenant_id
      ? await pool.query('SELECT * FROM complaints WHERE tenant_id = $1 ORDER BY created_at DESC', [tenant_id])
      : await pool.query('SELECT * FROM complaints ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST a tenant raises a new complaint/enquiry
router.post('/', async (req, res) => {
  try {
    const { tenant_id, subject, message } = req.body;
    const result = await pool.query(
      `INSERT INTO complaints (tenant_id, subject, message) VALUES ($1, $2, $3) RETURNING *`,
      [tenant_id, subject, message]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT mark a complaint resolved
router.put('/:id/resolve', async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE complaints SET status='resolved' WHERE id=$1 RETURNING *`,
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Complaint not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
