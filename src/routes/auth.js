const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const router = express.Router();
const pool = require('../db');

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    const cleanEmail = String(email || '').trim().toLowerCase();

    if (!cleanEmail || !password) {
      return res.status(400).json({
        message: 'Email and password are required.',
      });
    }

    const result = await pool.query(
      'SELECT * FROM users WHERE LOWER(email) = $1',
      [cleanEmail]
    );

    console.log('LOGIN DEBUG:', {
      email: cleanEmail,
      rowsFound: result.rows.length,
      userEmail: result.rows[0]?.email,
      userRole: result.rows[0]?.role,
      hasPasswordHash: !!result.rows[0]?.password_hash,
    });

    const user = result.rows[0];

    if (!user) {
      return res.status(401).json({
        message: 'Invalid email or password',
      });
    }

    const validPassword = await bcrypt.compare(
      password,
      user.password_hash
    );

    if (!validPassword) {
      return res.status(401).json({
        message: 'Invalid email or password',
      });
    }

    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        role: user.role,
      },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    res.cookie('auth_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 1000,
      path: '/',
    });

    res.json({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      agentId: user.agent_id,
      tenantId: user.tenant_id,
      token,
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      message: 'Server error',
    });
  }
});

module.exports = router;