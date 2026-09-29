const express = require('express');
const router = express.Router();
const pool = require('../db');
const { sendReceiptEmail } = require('../services/email');

const PAYSTACK_API_URL = 'https://api.paystack.co';

// GET all payments (with tenant + property joined in)
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        pay.*,
        t.name AS tenant_name,
        t.email AS tenant_email,
        p.name AS property_name,
        p.currency
      FROM payments pay
      JOIN tenants t ON t.id = pay.tenant_id
      JOIN properties p ON p.id = t.property_id
      ORDER BY pay.created_at DESC
    `);

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST create a new payment record (opens a rent period)
router.post('/', async (req, res) => {
  try {
    const {
      tenant_id,
      amount_due,
      period_start,
      period_end,
      lease_period_label,
    } = req.body;

    if (!tenant_id || !amount_due || !period_start || !period_end) {
      return res.status(400).json({
        error: 'tenant_id, amount_due, period_start and period_end are required',
      });
    }

    const result = await pool.query(
      `
        INSERT INTO payments (
          tenant_id,
          amount_due,
          period_start,
          period_end,
          lease_period_label
        )
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
      `,
      [
        tenant_id,
        amount_due,
        period_start,
        period_end,
        lease_period_label || null,
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

/*
 * POST initialize a Paystack transaction.
 *
 * The frontend calls this endpoint before opening Paystack.
 * The backend:
 *   1. Finds the payment record.
 *   2. Calculates the real outstanding amount.
 *   3. Gets the tenant email.
 *   4. Creates the Paystack transaction using the SECRET key.
 *   5. Returns Paystack's access_code and reference to the frontend.
 *
 * The secret key never reaches the browser.
 */
router.post('/:id/initialize-paystack', async (req, res) => {
  try {
    if (!process.env.PAYSTACK_SECRET_KEY) {
      console.error('PAYSTACK_SECRET_KEY is not configured');

      return res.status(500).json({
        error: 'Paystack is not configured on the server.',
      });
    }

    const paymentResult = await pool.query(
      `
        SELECT
          pay.*,
          t.name AS tenant_name,
          t.email AS tenant_email,
          p.name AS property_name,
          p.currency
        FROM payments pay
        JOIN tenants t ON t.id = pay.tenant_id
        JOIN properties p ON p.id = t.property_id
        WHERE pay.id = $1
        LIMIT 1
      `,
      [req.params.id]
    );

    if (paymentResult.rows.length === 0) {
      return res.status(404).json({
        error: 'Payment record not found.',
      });
    }

    const payment = paymentResult.rows[0];

    if (!payment.tenant_email) {
      return res.status(400).json({
        error: 'Tenant email is required before starting payment.',
      });
    }

    if (payment.status === 'paid') {
      return res.status(409).json({
        error: 'This payment has already been paid.',
      });
    }

    const amountDue = Number(payment.amount_due);
    const amountPaid = Number(payment.amount_paid || 0);
    const outstandingAmount = amountDue - amountPaid;

    if (!Number.isFinite(outstandingAmount) || outstandingAmount <= 0) {
      return res.status(400).json({
        error: 'There is no outstanding amount to pay.',
      });
    }

    // Paystack expects the amount in the smallest currency unit.
    const amountInKobo = Math.round(outstandingAmount * 100);

    if (amountInKobo <= 0) {
      return res.status(400).json({
        error: 'Invalid payment amount.',
      });
    }

    // Generate the reference on the server.
    const reference = `FUG-${payment.id}-${Date.now()}`;

    const initializeRes = await fetch(
      `${PAYSTACK_API_URL}/transaction/initialize`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: payment.tenant_email,
          amount: amountInKobo,
          currency: payment.currency || 'NGN',
          reference,
          metadata: {
            payment_id: payment.id,
            tenant_id: payment.tenant_id,
            tenant_name: payment.tenant_name,
            property_name: payment.property_name,
          },
        }),
      }
    );

    const initializeData = await initializeRes.json();

    if (!initializeRes.ok || !initializeData.status) {
      console.error('Paystack initialization failed:', initializeData);

      return res.status(400).json({
        error:
          initializeData.message ||
          'Paystack could not initialize the transaction.',
      });
    }

    // Save the server-generated Paystack reference against this payment.
    await pool.query(
      `
        UPDATE payments
        SET paystack_ref = $1
        WHERE id = $2
      `,
      [reference, payment.id]
    );

    res.json({
      payment_id: payment.id,
      reference: initializeData.data.reference,
      access_code: initializeData.data.access_code,
      authorization_url: initializeData.data.authorization_url,
      amount: outstandingAmount,
      currency: payment.currency || 'NGN',
    });
  } catch (err) {
    console.error('Paystack initialization error:', err);

    res.status(500).json({
      error: 'Server error while initializing payment.',
    });
  }
});

/*
 * Shared logic:
 * mark a payment paid + auto-create commission + email a receipt.
 *
 * Used by the Paystack verification route and the manual/testing route.
 */
async function completePayment(
  client,
  paymentId,
  amountPaid,
  paystackRef
) {
  const receiptNumber = `REC-FUG-${Date.now()
    .toString()
    .slice(-8)}`;

  const paymentResult = await client.query(
    `
      UPDATE payments
      SET
        amount_paid = $1,
        status = 'paid',
        paystack_ref = $2,
        receipt_number = $3,
        paid_at = now()
      WHERE id = $4
        AND status != 'paid'
      RETURNING *
    `,
    [amountPaid, paystackRef, receiptNumber, paymentId]
  );

  if (paymentResult.rows.length === 0) {
    return null;
  }

  const payment = paymentResult.rows[0];

  // Fetch tenant + property + agent information.
  const infoResult = await client.query(
    `
      SELECT
        t.name AS tenant_name,
        t.email AS tenant_email,
        p.name AS property_name,
        p.agent_id,
        a.commission_rate
      FROM tenants t
      JOIN properties p ON p.id = t.property_id
      LEFT JOIN agents a ON a.id = p.agent_id
      WHERE t.id = $1
    `,
    [payment.tenant_id]
  );

  const info = infoResult.rows[0];

  // Automatically create agent commission if applicable.
  if (info?.agent_id && info?.commission_rate != null) {
    const commissionAmount =
      (parseFloat(amountPaid) *
        parseFloat(info.commission_rate)) /
      100;

    await client.query(
      `
        INSERT INTO commissions (
          payment_id,
          agent_id,
          amount_owed
        )
        VALUES ($1, $2, $3)
      `,
      [
        payment.id,
        info.agent_id,
        commissionAmount,
      ]
    );
  }

  // Send receipt email.
  // Email failure should not undo the successful payment.
  if (info?.tenant_email) {
    sendReceiptEmail({
      to: info.tenant_email,
      tenantName: info.tenant_name,
      amount: amountPaid,
      propertyName: info.property_name,
      period:
        payment.lease_period_label ||
        `${payment.period_start} to ${payment.period_end}`,
    }).catch((emailError) => {
      console.error(
        'Receipt email failed:',
        emailError
      );
    });
  }

  return payment;
}

/*
 * POST verify a Paystack payment and mark it paid.
 *
 * This is the SOURCE OF TRUTH.
 *
 * We do NOT trust the frontend's success callback.
 * We ask Paystack directly whether the reference succeeded,
 * then verify the amount against our own payment record.
 */
router.post('/:id/verify-paystack', async (req, res) => {
  const client = await pool.connect();

  try {
    if (!process.env.PAYSTACK_SECRET_KEY) {
      return res.status(500).json({
        error: 'Paystack is not configured on the server.',
      });
    }

    const { reference } = req.body;

    if (!reference) {
      return res.status(400).json({
        error: 'Missing payment reference.',
      });
    }

    // Get our own payment record first.
    const paymentResult = await client.query(
      `
        SELECT *
        FROM payments
        WHERE id = $1
        LIMIT 1
      `,
      [req.params.id]
    );

    if (paymentResult.rows.length === 0) {
      return res.status(404).json({
        error: 'Payment record not found.',
      });
    }

    const paymentRecord = paymentResult.rows[0];

    if (paymentRecord.status === 'paid') {
      return res.status(409).json({
        error: 'This payment was already recorded.',
      });
    }

    /*
     * If the payment already has a server-generated reference,
     * require the same reference during verification.
     */
    if (
      paymentRecord.paystack_ref &&
      paymentRecord.paystack_ref !== reference
    ) {
      return res.status(400).json({
        error: 'Payment reference does not match this payment.',
      });
    }

    // Ask Paystack directly whether this transaction succeeded.
    const verifyRes = await fetch(
      `${PAYSTACK_API_URL}/transaction/verify/${encodeURIComponent(
        reference
      )}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        },
      }
    );

    const verifyData = await verifyRes.json();

    if (
      !verifyRes.ok ||
      !verifyData.status ||
      verifyData.data?.status !== 'success'
    ) {
      console.error(
        'Paystack verification failed:',
        verifyData
      );

      return res.status(400).json({
        error: 'Payment could not be verified.',
      });
    }

    const amountPaid =
      Number(verifyData.data.amount) / 100;

    const expectedAmount =
      Number(paymentRecord.amount_due) -
      Number(paymentRecord.amount_paid || 0);

    /*
     * IMPORTANT:
     * The amount Paystack says was paid must match the
     * outstanding amount in PropertyPro.
     */
    const expectedKobo = Math.round(
      expectedAmount * 100
    );

    const actualKobo = Number(
      verifyData.data.amount
    );

    if (actualKobo !== expectedKobo) {
      console.error('Payment amount mismatch:', {
        paymentId: paymentRecord.id,
        expectedKobo,
        actualKobo,
        reference,
      });

      return res.status(400).json({
        error:
          'Payment amount does not match the outstanding amount.',
      });
    }

    await client.query('BEGIN');

    const payment = await completePayment(
      client,
      req.params.id,
      amountPaid,
      reference
    );

    if (!payment) {
      await client.query('ROLLBACK');

      return res.status(409).json({
        error: 'This payment was already recorded.',
      });
    }

    await client.query('COMMIT');

    res.json(payment);
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error(
        'Rollback failed:',
        rollbackError
      );
    }

    console.error(
      'Paystack verification error:',
      err
    );

    res.status(500).json({
      error: 'Server error while verifying payment.',
    });
  } finally {
    client.release();
  }
});

/*
 * POST manual mark-paid.
 *
 * Kept for admin/testing purposes.
 */
router.post('/:id/mark-paid', async (req, res) => {
  const client = await pool.connect();

  try {
    const { amount_paid, paystack_ref } = req.body;

    if (
      amount_paid === undefined ||
      amount_paid === null
    ) {
      return res.status(400).json({
        error: 'amount_paid is required.',
      });
    }

    await client.query('BEGIN');

    const payment = await completePayment(
      client,
      req.params.id,
      amount_paid,
      paystack_ref || 'manual'
    );

    if (!payment) {
      await client.query('ROLLBACK');

      return res.status(409).json({
        error: 'This payment was already recorded.',
      });
    }

    await client.query('COMMIT');

    res.json(payment);
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error(
        'Rollback failed:',
        rollbackError
      );
    }

    console.error(err);

    res.status(500).json({
      error: 'Server error',
    });
  } finally {
    client.release();
  }
});

module.exports = router;