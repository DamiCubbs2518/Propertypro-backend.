const express = require('express');
const router = express.Router();
const pool = require('../db');

const { authenticate } = require('../middleware/auth');

// Get notifications for the currently logged-in user
router.get('/', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT *
       FROM notifications
       WHERE recipient_user_id = $1
       ORDER BY created_at DESC`,
      [req.auth.id]
    );

    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: 'Server error',
    });
  }
});

// Mark one notification as read
router.patch('/:id/read', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE notifications
       SET is_read = true
       WHERE id = $1
         AND recipient_user_id = $2
       RETURNING *`,
      [req.params.id, req.auth.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'Notification not found.',
      });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: 'Server error',
    });
  }
});

// Mark all notifications as read
router.patch('/read-all', authenticate, async (req, res) => {
  try {
    await pool.query(
      `UPDATE notifications
       SET is_read = true
       WHERE recipient_user_id = $1
         AND is_read = false`,
      [req.auth.id]
    );

    res.json({
      message: 'All notifications marked as read.',
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: 'Server error',
    });
  }
});

module.exports = router;