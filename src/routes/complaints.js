const express = require('express');
const router = express.Router();
const pool = require('../db');

const {
  authenticate,
  requireRoles,
} = require('../middleware/auth');

const {
  notifyAdmins,
  notifyTenantByTenantId,
} = require('../services/notifications');

// GET complaints
// Admins can see all complaints.
// Tenants can see only their own complaints.
router.get('/', authenticate, async (req, res) => {
  try {
    const role = String(req.auth?.role || '').toLowerCase();

    if (role === 'admin') {
      const result = await pool.query(
        `SELECT mc.*, t.name AS tenant_name, t.email AS tenant_email
         FROM maintenance_complaints mc
         JOIN tenants t ON t.id = mc.tenant_id
         ORDER BY mc.id DESC`
      );

      return res.json(result.rows);
    }

    if (role === 'tenant') {
      const result = await pool.query(
        `SELECT mc.*, t.name AS tenant_name, t.email AS tenant_email
         FROM maintenance_complaints mc
         JOIN tenants t ON t.id = mc.tenant_id
         JOIN users u ON LOWER(u.email) = LOWER(t.email)
         WHERE u.id = $1
         ORDER BY mc.id DESC`,
        [req.auth.id]
      );

      return res.json(result.rows);
    }

    return res.status(403).json({
      error: 'You do not have permission to view complaints.',
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      error: 'Server error',
    });
  }
});

// POST a new complaint
// Tenant only.
router.post(
  '/',
  authenticate,
  requireRoles('tenant'),
  async (req, res) => {
    try {
      const { category, description, property_id } = req.body;

      if (!category || !description || !property_id) {
        return res.status(400).json({
          error: 'Category, description, and property are required.',
        });
      }

      const tenantResult = await pool.query(
        `SELECT t.id, t.name, t.email
         FROM tenants t
         JOIN users u ON LOWER(u.email) = LOWER(t.email)
         WHERE u.id = $1
         LIMIT 1`,
        [req.auth.id]
      );

      if (tenantResult.rows.length === 0) {
        return res.status(404).json({
          error: 'Tenant record not found.',
        });
      }

      const tenant = tenantResult.rows[0];

      const complaintResult = await pool.query(
        `INSERT INTO maintenance_complaints
          (tenant_id, property_id, category, description)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [tenant.id, property_id, category, description]
      );

      const complaint = complaintResult.rows[0];

      await notifyAdmins({
        type: 'complaint_created',
        title: 'New maintenance complaint',
        message: `${tenant.name} submitted a new ${category} complaint.`,
        relatedId: complaint.id,
        emailSubject: 'New PropertyPro complaint',
        emailMessage: `
          <p><strong>${tenant.name}</strong> has submitted a new maintenance complaint.</p>
          <p><strong>Category:</strong> ${category}</p>
          <p><strong>Description:</strong> ${description}</p>
        `,
      });

      return res.status(201).json(complaint);
    } catch (error) {
      console.error(error);
      return res.status(500).json({
        error: 'Server error',
      });
    }
  }
);

// Admin responds to a complaint.
router.put(
  '/:id/respond',
  authenticate,
  requireRoles('admin'),
  async (req, res) => {
    try {
      const { admin_response, status = 'in_progress' } = req.body;

      if (!admin_response) {
        return res.status(400).json({
          error: 'Admin response is required.',
        });
      }

      const allowedStatuses = ['open', 'in_progress', 'resolved'];

      if (!allowedStatuses.includes(status)) {
        return res.status(400).json({
          error: 'Invalid complaint status.',
        });
      }

      const result = await pool.query(
        `UPDATE maintenance_complaints
         SET admin_response = $1,
             status = $2,
             responded_at = NOW()
         WHERE id = $3
         RETURNING *`,
        [admin_response, status, req.params.id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          error: 'Complaint not found.',
        });
      }

      const complaint = result.rows[0];

      await notifyTenantByTenantId({
        tenantId: complaint.tenant_id,
        type: 'complaint_response',
        title: 'Your complaint has been updated',
        message: `An administrator responded to your ${complaint.category} complaint.`,
        relatedId: complaint.id,
        emailSubject: 'PropertyPro complaint update',
        emailMessage: `
          <p>An administrator has responded to your complaint.</p>
          <p><strong>Category:</strong> ${complaint.category}</p>
          <p><strong>Response:</strong> ${admin_response}</p>
          <p><strong>Status:</strong> ${status}</p>
        `,
      });

      return res.json(complaint);
    } catch (error) {
      console.error(error);
      return res.status(500).json({
        error: 'Server error',
      });
    }
  }
);

// Admin resolves a complaint.
router.put(
  '/:id/resolve',
  authenticate,
  requireRoles('admin'),
  async (req, res) => {
    try {
      const result = await pool.query(
        `UPDATE maintenance_complaints
         SET status = 'resolved',
             responded_at = COALESCE(responded_at, NOW())
         WHERE id = $1
         RETURNING *`,
        [req.params.id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          error: 'Complaint not found.',
        });
      }

      const complaint = result.rows[0];

      await notifyTenantByTenantId({
        tenantId: complaint.tenant_id,
        type: 'complaint_resolved',
        title: 'Your complaint has been resolved',
        message: `Your ${complaint.category} complaint has been marked as resolved.`,
        relatedId: complaint.id,
        emailSubject: 'PropertyPro complaint resolved',
        emailMessage: `
          <p>Your maintenance complaint has been marked as <strong>resolved</strong>.</p>
          <p><strong>Category:</strong> ${complaint.category}</p>
        `,
      });

      return res.json(complaint);
    } catch (error) {
      console.error(error);
      return res.status(500).json({
        error: 'Server error',
      });
    }
  }
);

module.exports = router;