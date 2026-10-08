const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const pool = require('../db');

function toAgentItem(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    specialty: row.specialty || '',
    assignedPropertiesCount:
      parseInt(row.assigned_properties_count, 10) || 0,
    managedTenantsCount:
      parseInt(row.managed_tenants_count, 10) || 0,
    totalLeaseVolume:
      parseFloat(row.total_lease_volume) || 0,
    unremittedCommission:
      parseFloat(row.unremitted_commission) || 0,
    remittedCommission:
      parseFloat(row.remitted_commission) || 0,
    status: row.status,
  };
}

/* =========================
   GET ALL AGENTS
========================= */

router.get('/', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        a.*,

        (
          SELECT COUNT(*)
          FROM properties p
          WHERE p.agent_id = a.id
        ) AS assigned_properties_count,

        (
          SELECT COUNT(*)
          FROM tenants t
          JOIN properties p ON p.id = t.property_id
          WHERE p.agent_id = a.id
        ) AS managed_tenants_count,

        (
          SELECT COALESCE(SUM(t.rent_amount), 0)
          FROM tenants t
          JOIN properties p ON p.id = t.property_id
          WHERE p.agent_id = a.id
        ) AS total_lease_volume,

        (
          SELECT COALESCE(SUM(c.amount_owed), 0)
          FROM commissions c
          WHERE c.agent_id = a.id
            AND c.is_remitted = false
        ) AS unremitted_commission,

        (
          SELECT COALESCE(SUM(c.amount_owed), 0)
          FROM commissions c
          WHERE c.agent_id = a.id
            AND c.is_remitted = true
        ) AS remitted_commission

      FROM agents a
      ORDER BY a.created_at DESC
    `);

    res.json(result.rows.map(toAgentItem));
  } catch (err) {
    console.error('GET AGENTS ERROR:', err);

    res.status(500).json({
      error: 'Server error while fetching agents.',
      details: err.message,
    });
  }
});

/* =========================
   GET COMMISSIONS
========================= */

router.get('/commissions', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        c.id,
        a.name AS agent_name,
        p.name AS property_name,
        p.currency,
        a.commission_rate,
        c.amount_owed,
        c.is_remitted,
        c.remitted_at

      FROM commissions c

      JOIN agents a
        ON a.id = c.agent_id

      JOIN payments pay
        ON pay.id = c.payment_id

      JOIN tenants t
        ON t.id = pay.tenant_id

      JOIN properties p
        ON p.id = t.property_id

      ORDER BY c.created_at DESC
    `);

    res.json(result.rows);
  } catch (err) {
    console.error('GET COMMISSIONS ERROR:', err);

    res.status(500).json({
      error: 'Server error while fetching commissions.',
      details: err.message,
    });
  }
});

/* =========================
   CREATE AGENT + LOGIN ACCOUNT
========================= */

router.post('/', async (req, res) => {
  const client = await pool.connect();
  let transactionStarted = false;

  try {
    const {
      name,
      email,
      phone,
      specialty,
      commission_rate,
      status,
      password,
    } = req.body;

    const cleanName = String(name || '').trim();
    const cleanEmail = String(email || '').trim().toLowerCase();
    const cleanPhone = String(phone || '').trim();
    const cleanPassword = String(password || '');

    if (!cleanName) {
      return res.status(400).json({
        error: 'Agent name is required.',
      });
    }

    if (!cleanEmail) {
      return res.status(400).json({
        error: 'Agent email is required.',
      });
    }

    if (!cleanPhone) {
      return res.status(400).json({
        error: 'Agent phone number is required.',
      });
    }

    if (cleanPassword.length < 6) {
      return res.status(400).json({
        error: 'Agent password must be at least 6 characters.',
      });
    }

    await client.query('BEGIN');
    transactionStarted = true;

    /* Check duplicate login email */
    const existingUser = await client.query(
      `
      SELECT id, email
      FROM users
      WHERE LOWER(email) = $1
      LIMIT 1
      `,
      [cleanEmail]
    );

    if (existingUser.rows.length > 0) {
      await client.query('ROLLBACK');
      transactionStarted = false;

      return res.status(409).json({
        error: 'An account with this email already exists.',
      });
    }

    /* Check duplicate agent email */
    const existingAgent = await client.query(
      `
      SELECT id, email
      FROM agents
      WHERE LOWER(email) = $1
      LIMIT 1
      `,
      [cleanEmail]
    );

    if (existingAgent.rows.length > 0) {
      await client.query('ROLLBACK');
      transactionStarted = false;

      return res.status(409).json({
        error: 'An agent with this email already exists.',
      });
    }

    /* Create agent */
    const agentResult = await client.query(
      `
      INSERT INTO agents
        (
          name,
          email,
          phone,
          specialty,
          commission_rate,
          status
        )
      VALUES
        ($1, $2, $3, $4, $5, $6)
      RETURNING *
      `,
      [
        cleanName,
        cleanEmail,
        cleanPhone,
        specialty ? String(specialty).trim() : null,
        Number(commission_rate) || 10,
        status || 'Active',
      ]
    );

    const agent = agentResult.rows[0];

    /* Hash password */
    const passwordHash = await bcrypt.hash(cleanPassword, 12);

    /* Create login account */
    await client.query(
      `
      INSERT INTO users
        (
          name,
          email,
          password_hash,
          role,
          agent_id
        )
      VALUES
        ($1, $2, $3, $4, $5)
      `,
      [
        cleanName,
        cleanEmail,
        passwordHash,
        'AGENT',
        agent.id,
      ]
    );

    await client.query('COMMIT');
    transactionStarted = false;

    return res.status(201).json({
      ...toAgentItem(agent),
      message: 'Agent and login account created successfully.',
    });

  } catch (err) {
    if (transactionStarted) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('ROLLBACK ERROR:', rollbackError);
      }
    }

    console.error('CREATE AGENT ERROR:', err);

    return res.status(500).json({
      error: 'Server error while creating agent.',
      details: err.message,
    });

  } finally {
    client.release();
  }
});

/* =========================
   REMIT COMMISSION
========================= */

router.put('/commissions/:id/remit', async (req, res) => {
  try {
    const { is_remitted } = req.body;

    const result = await pool.query(
      `
      UPDATE commissions
      SET
        is_remitted = $1,
        remitted_at =
          CASE
            WHEN $1 THEN NOW()
            ELSE NULL
          END
      WHERE id = $2
      RETURNING *
      `,
      [is_remitted, req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'Commission not found.',
      });
    }

    res.json(result.rows[0]);

  } catch (err) {
    console.error('REMIT COMMISSION ERROR:', err);

    res.status(500).json({
      error: 'Server error while updating commission.',
      details: err.message,
    });
  }
});

module.exports = router;