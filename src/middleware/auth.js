const jwt = require('jsonwebtoken');
const pool = require('../db');

function authenticate(req, res, next) {
  const token = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7)
    : null;

  if (!token) {
    return res.status(401).json({ error: 'Sign in is required.' });
  }

  try {
    req.auth = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({
      error: 'Your session has expired. Please sign in again.',
    });
  }
}

function requireRoles(...roles) {
  const allowedRoles = roles.map((role) => role.toLowerCase());

  return (req, res, next) => {
    const userRole = String(req.auth?.role || '').toLowerCase();

    if (allowedRoles.includes(userRole)) {
      return next();
    }

    return res.status(403).json({
      error: 'You do not have permission to do that.',
    });
  };
}

async function requireTenantAccess(req, res, next) {
  const { id, role } = req.auth || {};
  const userRole = String(role || '').toLowerCase();

  try {
    if (userRole === 'admin') {
      return next();
    }

    if (userRole === 'tenant') {
      const result = await pool.query(
        `SELECT 1
         FROM users u
         JOIN tenants t
           ON LOWER(u.email) = LOWER(t.email)
         WHERE u.id = $1
           AND t.id = $2`,
        [id, req.params.id]
      );

      if (result.rowCount) {
        return next();
      }

      return res.status(403).json({
        error: 'You cannot access this tenant.',
      });
    }

    return res.status(403).json({
      error: 'You do not have permission to access this tenant.',
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      error: 'Server error',
    });
  }
}

module.exports = {
  authenticate,
  requireRoles,
  requireTenantAccess,
};