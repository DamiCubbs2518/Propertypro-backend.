const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db');

const router = express.Router();

// Every account type signs in through this one endpoint. The database is the
// source of truth for the account's role and linked agent/tenant record.
router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};

  if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  try {
    const result = await pool.query(
      `SELECT id, name, email, password_hash, role, avatar_url, agent_id, tenant_id
       FROM users
       WHERE LOWER(email) = LOWER($1)
       LIMIT 1`,
      [email.trim()]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    const user = result.rows[0];
    const passwordMatches = await bcrypt.compare(password, user.password_hash);

    if (!passwordMatches) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    if (!process.env.JWT_SECRET) {
      return res.status(500).json({ error: 'Authentication is not configured.' });
    }
    const role = String(user.role).toUpperCase();
    const session = { sub: user.id, role, agentId: user.agent_id || null, tenantId: user.tenant_id || null };
    const accessToken = jwt.sign(session, process.env.JWT_SECRET, { expiresIn: '8h' });
    return res.json({
      id: user.id,
      name: user.name,
      email: user.email,
      role,
      avatarUrl: user.avatar_url || undefined,
      agentId: user.agent_id || undefined,
      tenantId: user.tenant_id || undefined,
      accessToken,
    });
  } catch (error) {
    console.error('Login failed:', error);
    return res.status(500).json({ error: 'Unable to sign in right now.' });
  }
});

router.get('/me', require('../middleware/auth').authenticate, async (req, res) => {
  const result = await pool.query(
    `SELECT id, name, email, role, avatar_url, agent_id, tenant_id FROM users WHERE id = $1`,
    [req.auth.sub]
  );
  if (!result.rowCount) return res.status(401).json({ error: 'Account no longer exists.' });
  const user = result.rows[0];
  return res.json({ id: user.id, name: user.name, email: user.email, role: String(user.role).toUpperCase(), avatarUrl: user.avatar_url || undefined, agentId: user.agent_id || undefined, tenantId: user.tenant_id || undefined });
});

module.exports = router;
