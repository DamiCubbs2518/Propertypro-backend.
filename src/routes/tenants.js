
const express = require('express');
const bcrypt = require('bcryptjs');

const router = express.Router();
const pool = require('../db');

const {
  authenticate,
  requireRoles,
  requireTenantAccess,
} = require('../middleware/auth');

const STATUS_MAP = {
  pending: 'Pending',
  paid: 'Paid',
  overdue: 'Overdue',
};

function toPaymentRecord(row) {
  const amountDue =
    parseFloat(row.amount_due ?? row.rent_amount) || 0;

  const amountPaid =
    parseFloat(row.amount_paid) || 0;

  return {
    id: row.id,
    propertyId: row.property_id,
    tenantName: row.name,
    tenantEmail: row.email,
    property: row.property_name,
    unit: row.property_name,
    amount: amountDue,
    status: STATUS_MAP[row.payment_status] || 'Pending',
    date: row.payment_created_at || null,
    dueDate: row.period_end || null,
    receiptNumber: row.receipt_number || undefined,
    agentId: row.agent_id || undefined,
    agentName: row.agent_name || undefined,
    agentCommissionAmount: row.commission_amount
      ? parseFloat(row.commission_amount)
      : undefined,
    agentCommissionRemitted:
      row.commission_remitted ?? undefined,
    multiYearEligible: row.multi_year_eligible || false,
    amountOwed: Math.max(amountDue - amountPaid, 0),
    amountPaid,
    leasePeriod:
      row.lease_period_label || row.rent_cycle || '',
    phone: row.phone,
    misconductStrikes: row.misconduct_strikes || [],
  };
}

const BASE_QUERY = `
  SELECT
    t.*,
    p.name AS property_name,
    p.currency,
    p.agent_id,
    ag.name AS agent_name,

    latest_pay.id AS payment_id,
    latest_pay.amount_due,
    latest_pay.amount_paid,
    latest_pay.status AS payment_status,
    latest_pay.period_end,
    latest_pay.lease_period_label,
    latest_pay.receipt_number,
    latest_pay.created_at AS payment_created_at,

    comm.amount_owed AS commission_amount,
    comm.is_remitted AS commission_remitted,

    COALESCE(misconducts.strikes, '[]'::json) AS misconduct_strikes

  FROM tenants t

  JOIN properties p
    ON p.id = t.property_id

  LEFT JOIN agents ag
    ON ag.id = p.agent_id

  LEFT JOIN LATERAL (
    SELECT *
    FROM payments
    WHERE payments.tenant_id = t.id
    ORDER BY payments.period_start DESC
    LIMIT 1
  ) latest_pay
    ON true

  LEFT JOIN commissions comm
    ON comm.payment_id = latest_pay.id

  LEFT JOIN LATERAL (
    SELECT json_agg(
      json_build_object(
        'id', id,
        'tenantId', tenant_id,
        'date', occurred_at,
        'offenseTitle', offense_title,
        'description', description,
        'penaltyAmount', penalty_amount,
        'proofImageUrl', proof_image_url
      )
    ) AS strikes
    FROM misconduct_records
    WHERE tenant_id = t.id
  ) misconducts
    ON true
`;

// ============================================================
// GET CURRENT LOGGED-IN TENANT
// IMPORTANT: /me MUST COME BEFORE /:id
// ============================================================

router.get('/me', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `
        SELECT
          t.*,
          p.name AS property_name,

          latest_pay.amount_due,
          latest_pay.amount_paid,
          latest_pay.status AS payment_status,
          latest_pay.period_end,
          latest_pay.lease_period_label,
          latest_pay.receipt_number,
          latest_pay.created_at AS payment_created_at

        FROM users u

        JOIN tenants t
          ON t.id = u.tenant_id

        LEFT JOIN properties p
          ON p.id = t.property_id

        LEFT JOIN LATERAL (
          SELECT *
          FROM payments
          WHERE payments.tenant_id = t.id
          ORDER BY payments.period_start DESC
          LIMIT 1
        ) latest_pay
          ON true

        WHERE u.id = $1
          AND LOWER(u.role) = 'tenant'

        LIMIT 1
      `,
      [req.auth.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'Tenant record not found for this account.',
      });
    }

    const row = result.rows[0];

    res.json({
      id: row.id,
      propertyId: row.property_id,
      tenantName: row.name,
      tenantEmail: row.email,
      phone: row.phone,

      property:
        row.property_name || 'PropertyPro Residence',

      unit:
        row.property_name || 'Resident Unit',

      amount:
        parseFloat(row.amount_due ?? row.rent_amount) || 0,

      status:
        STATUS_MAP[row.payment_status] || 'Pending',

      date:
        row.payment_created_at || null,

      dueDate:
        row.period_end || null,

      receiptNumber:
        row.receipt_number || undefined,

      multiYearEligible:
        row.multi_year_eligible || false,

      amountOwed: Math.max(
        (parseFloat(row.amount_due ?? row.rent_amount) || 0) -
          (parseFloat(row.amount_paid) || 0),
        0
      ),

      amountPaid:
        parseFloat(row.amount_paid) || 0,

      leasePeriod:
        row.lease_period_label ||
        row.rent_cycle ||
        '',

      misconductStrikes: [],
    });
  } catch (err) {
    console.error('GET /api/tenants/me error:', err);

    res.status(500).json({
      error: 'Server error',
    });
  }
});

// ============================================================
// GET ALL TENANTS - ADMIN
// ============================================================

router.get(
  '/',
  authenticate,
  requireRoles('ADMIN'),
  async (req, res) => {
    try {
      const result = await pool.query(
        `${BASE_QUERY} ORDER BY t.created_at DESC`
      );

      res.json(result.rows.map(toPaymentRecord));
    } catch (err) {
      console.error(err);

      res.status(500).json({
        error: 'Server error',
      });
    }
  }
);

// ============================================================
// GET TENANTS BY AGENT
// ============================================================

router.get(
  '/by-agent/:agentId',
  authenticate,
  async (req, res) => {
    if (
      req.auth.role !== 'ADMIN' &&
      (
        req.auth.role !== 'AGENT' ||
        req.auth.agentId !== req.params.agentId
      )
    ) {
      return res.status(403).json({
        error: 'You cannot access this tenant list.',
      });
    }

    try {
      const result = await pool.query(
        `${BASE_QUERY}
         WHERE p.agent_id = $1
         ORDER BY t.created_at DESC`,
        [req.params.agentId]
      );

      res.json(result.rows.map(toPaymentRecord));
    } catch (err) {
      console.error(err);

      res.status(500).json({
        error: 'Server error',
      });
    }
  }
);

// ============================================================
// GET TENANT BY ID
// ============================================================

router.get(
  '/:id',
  authenticate,
  requireTenantAccess,
  async (req, res) => {
    try {
      const result = await pool.query(
        `${BASE_QUERY} WHERE t.id = $1`,
        [req.params.id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          error: 'Tenant not found',
        });
      }

      res.json(toPaymentRecord(result.rows[0]));
    } catch (err) {
      console.error(err);

      res.status(500).json({
        error: 'Server error',
      });
    }
  }
);

// ============================================================
// GET PUBLIC PAYMENT LINK
// ============================================================

router.get('/link/:token', async (req, res) => {
  try {
    const result = await pool.query(
      `
        SELECT
          t.id,
          t.name,
          t.rent_amount,
          t.rent_cycle,
          p.name AS property_name,
          p.city,
          p.currency
        FROM tenants t
        JOIN properties p
          ON p.id = t.property_id
        WHERE t.payment_link_token = $1
      `,
      [req.params.token]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'Invalid payment link',
      });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: 'Server error',
    });
  }
});

// ============================================================
// CREATE TENANT + LOGIN ACCOUNT - ADMIN
// ============================================================

router.post(
  '/',
  authenticate,
  requireRoles('ADMIN'),
  async (req, res) => {
    const client = await pool.connect();
    let transactionStarted = false;

    try {
      const {
        property_id,
        name,
        email,
        phone,
        rent_amount,
        rent_cycle,
        multi_year_eligible,
        password,
      } = req.body;

      const cleanName = String(name || '').trim();
      const cleanEmail = String(email || '').trim().toLowerCase();
      const cleanPassword = String(password || '');

      if (!property_id) {
        return res.status(400).json({
          error: 'Property is required.',
        });
      }

      if (!cleanName) {
        return res.status(400).json({
          error: 'Tenant name is required.',
        });
      }

      if (!cleanEmail) {
        return res.status(400).json({
          error: 'Tenant email is required.',
        });
      }

      if (!cleanPassword || cleanPassword.length < 6) {
        return res.status(400).json({
          error: 'Tenant password must be at least 6 characters.',
        });
      }

      await client.query('BEGIN');
      transactionStarted = true;

      const propertyResult = await client.query(
        `
          SELECT id
          FROM properties
          WHERE id = $1
          LIMIT 1
        `,
        [property_id]
      );

      if (propertyResult.rows.length === 0) {
        await client.query('ROLLBACK');
        transactionStarted = false;

        return res.status(404).json({
          error: 'Property not found.',
        });
      }

      const existingUser = await client.query(
        `
          SELECT id
          FROM users
          WHERE LOWER(email) = LOWER($1)
          LIMIT 1
        `,
        [cleanEmail]
      );

      if (existingUser.rows.length > 0) {
        await client.query('ROLLBACK');
        transactionStarted = false;

        return res.status(409).json({
          error: 'A user account with this email already exists.',
        });
      }

      const tenantResult = await client.query(
        `
          INSERT INTO tenants (
            property_id,
            name,
            email,
            phone,
            rent_amount,
            rent_cycle,
            multi_year_eligible
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING *
        `,
        [
          property_id,
          cleanName,
          cleanEmail,
          phone || null,
          rent_amount || 0,
          rent_cycle || 'monthly',
          multi_year_eligible || false,
        ]
      );

      const tenant = tenantResult.rows[0];

      const passwordHash = await bcrypt.hash(cleanPassword, 12);

      await client.query(
        `
          INSERT INTO users (
            name,
            email,
            password_hash,
            role,
            tenant_id
          )
          VALUES ($1, $2, $3, 'TENANT', $4)
        `,
        [
          cleanName,
          cleanEmail,
          passwordHash,
          tenant.id,
        ]
      );

      await client.query('COMMIT');
      transactionStarted = false;

      res.status(201).json(tenant);
    } catch (err) {
      if (transactionStarted) {
        await client.query('ROLLBACK').catch(() => {});
      }

      console.error('POST /api/tenants error:', err);

      res.status(500).json({
        error: 'Server error',
      });
    } finally {
      client.release();
    }
  }
);

// ============================================================
// UPDATE TENANT - ADMIN
// ============================================================

router.put(
  '/:id',
  authenticate,
  requireRoles('ADMIN'),
  async (req, res) => {
    try {
      const {
        name,
        email,
        phone,
        rent_amount,
        rent_cycle,
      } = req.body;

      const cleanEmail = String(email || '')
        .trim()
        .toLowerCase();

      const result = await pool.query(
        `
          UPDATE tenants
          SET
            name = $1,
            email = $2,
            phone = $3,
            rent_amount = $4,
            rent_cycle = $5
          WHERE id = $6
          RETURNING *
        `,
        [
          name,
          cleanEmail,
          phone,
          rent_amount,
          rent_cycle,
          req.params.id,
        ]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          error: 'Tenant not found',
        });
      }

      await pool.query(
        `
          UPDATE users
          SET
            name = $1,
            email = $2
          WHERE tenant_id = $3
        `,
        [
          name,
          cleanEmail,
          req.params.id,
        ]
      );

      res.json(result.rows[0]);
    } catch (err) {
      console.error(err);

      res.status(500).json({
        error: 'Server error',
      });
    }
  }
);

// ============================================================
// ADD MISCONDUCT
// ============================================================

router.post(
  '/:id/misconduct',
  authenticate,
  requireRoles('ADMIN'),
  async (req, res) => {
    try {
      const {
        offenseTitle,
        description,
        penaltyAmount,
        proofImageUrl,
        date,
      } = req.body;

      const result = await pool.query(
        `
          INSERT INTO misconduct_records (
            tenant_id,
            offense_title,
            description,
            penalty_amount,
            proof_image_url,
            occurred_at
          )
          VALUES (
            $1,
            $2,
            $3,
            $4,
            $5,
            COALESCE($6, CURRENT_DATE)
          )
          RETURNING *
        `,
        [
          req.params.id,
          offenseTitle,
          description,
          penaltyAmount || null,
          proofImageUrl || null,
          date || null,
        ]
      );

      res.status(201).json(result.rows[0]);
    } catch (err) {
      console.error(err);

      res.status(500).json({
        error: 'Server error',
      });
    }
  }
);

// ============================================================
// REMIT COMMISSION
// ============================================================

router.put(
  '/:id/remit-commission',
  authenticate,
  requireRoles('ADMIN'),
  async (req, res) => {
    try {
      const result = await pool.query(
        `
          UPDATE commissions
          SET
            is_remitted = true,
            remitted_at = now()
          WHERE payment_id = (
            SELECT id
            FROM payments
            WHERE tenant_id = $1
            ORDER BY period_start DESC
            LIMIT 1
          )
          RETURNING *
        `,
        [req.params.id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          error: 'No commission found for this tenant',
        });
      }

      res.json(result.rows[0]);
    } catch (err) {
      console.error(err);

      res.status(500).json({
        error: 'Server error',
      });
    }
  }
);

// ============================================================
// UPDATE MULTI-YEAR ELIGIBILITY
// ============================================================

router.put(
  '/:id/multi-year',
  authenticate,
  requireRoles('ADMIN'),
  async (req, res) => {
    try {
      const { isEligible } = req.body;

      const result = await pool.query(
        `
          UPDATE tenants
          SET multi_year_eligible = $1
          WHERE id = $2
          RETURNING *
        `,
        [isEligible, req.params.id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          error: 'Tenant not found',
        });
      }

      res.json(result.rows[0]);
    } catch (err) {
      console.error(err);

      res.status(500).json({
        error: 'Server error',
      });
    }
  }
);

// ============================================================
// DELETE TENANT - ADMIN
// ============================================================

router.delete(
  '/:id',
  authenticate,
  requireRoles('ADMIN'),
  async (req, res) => {
    try {
      const result = await pool.query(
        `
          DELETE FROM tenants
          WHERE id = $1
          RETURNING id
        `,
        [req.params.id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          error: 'Tenant not found',
        });
      }

      res.json({
        deleted: true,
      });
    } catch (err) {
      console.error(err);

      res.status(500).json({
        error: 'Server error',
      });
    }
  }
);

module.exports = router;
