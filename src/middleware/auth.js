const jwt = require('jsonwebtoken');
const pool = require('../db');

function authenticate(req, res, next) {
  const token = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7)
    : null;
  if (!token) return res.status(401).json({ error: 'Sign in is required.' });
  try {
    req.auth = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Your session has expired. Please sign in again.' });
  }
}

function requireRoles(...roles) {
  return (req, res, next) => roles.includes(req.auth?.role)
    ? next()
    : res.status(403).json({ error: 'You do not have permission to do that.' });
}

async function requireTenantAccess(req, res, next) {
  const { role, tenantId, agentId } = req.auth || {};
  if (role === 'ADMIN' || (role === 'TENANT' && tenantId === req.params.id)) return next();
  if (role !== 'AGENT' || !agentId) return res.status(403).json({ error: 'You cannot access this tenant.' });
  try {
    const result = await pool.query(
      `SELECT 1 FROM tenants t JOIN properties p ON p.id = t.property_id
       WHERE t.id = $1 AND p.agent_id = $2`, [req.params.id, agentId]
    );
    return result.rowCount ? next() : res.status(403).json({ error: 'This tenant is not assigned to you.' });
  } catch (error) {
    return next(error);
  }
}

module.exports = { authenticate, requireRoles, requireTenantAccess };
