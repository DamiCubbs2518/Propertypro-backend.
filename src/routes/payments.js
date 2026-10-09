const express = require('express');
const router = express.Router();
const pool = require('../db');
const { sendReceiptEmail } = require('../services/email');
const {
  authenticate,
  requireRoles,
} = require('../middleware/auth');

const PAYSTACK_API_URL = 'https://api.paystack.co';

/*
 * ============================================================
 * HELPER: INITIALIZE PAYSTACK TRANSACTION
 * ============================================================
 */

async function initializePaystackTransaction({
  paymentId,
  years = 1,
  callbackUrl,
}) {
  if (!process.env.PAYSTACK_SECRET_KEY) {
    const error = new Error(
      'Paystack is not configured on the server.'
    );

    error.statusCode = 500;
    throw error;
  }

  const requestedYears = Number(years);

  if (
    !Number.isInteger(requestedYears) ||
    requestedYears < 1 ||
    requestedYears > 4
  ) {
    const error = new Error(
      'Payment period must be between 1 and 4 years.'
    );

    error.statusCode = 400;
    throw error;
  }

  /*
   * Get the payment + tenant information.
   */
  const paymentResult = await pool.query(
    `
      SELECT
        pay.*,
        t.name AS tenant_name,
        t.email AS tenant_email,
        t.rent_amount,
        t.multi_year_eligible,
        p.name AS property_name,
        p.currency
      FROM payments pay
      JOIN tenants t
        ON t.id = pay.tenant_id
      JOIN properties p
        ON p.id = t.property_id
      WHERE pay.id = $1
      LIMIT 1
    `,
    [paymentId]
  );

  if (paymentResult.rows.length === 0) {
    const error = new Error(
      'Payment record not found.'
    );

    error.statusCode = 404;
    throw error;
  }

  const payment = paymentResult.rows[0];

  if (payment.status === 'paid') {
    const error = new Error(
      'This payment has already been paid.'
    );

    error.statusCode = 409;
    throw error;
  }

  if (!payment.tenant_email) {
    const error = new Error(
      'Tenant email is required before starting payment.'
    );

    error.statusCode = 400;
    throw error;
  }

  /*
   * Multi-year payments must have Admin approval.
   */
  if (
    requestedYears > 1 &&
    !payment.multi_year_eligible
  ) {
    const error = new Error(
      'Multi-year advance payment has not been approved for this tenant.'
    );

    error.statusCode = 403;
    throw error;
  }

  /*
   * IMPORTANT:
   * The backend calculates the amount.
   *
   * We do NOT trust the amount coming from the browser.
   */
  const baseRent = Math.round(
    Number(payment.rent_amount)
  );

  if (
    !Number.isFinite(baseRent) ||
    baseRent <= 0
  ) {
    const error = new Error(
      'The tenant rent amount is invalid.'
    );

    error.statusCode = 400;
    throw error;
  }

  const targetAmountDue =
    baseRent * requestedYears;

  const amountAlreadyPaid = Math.round(
    Number(payment.amount_paid || 0)
  );

  const outstandingAmount =
    targetAmountDue - amountAlreadyPaid;

  if (
    !Number.isFinite(outstandingAmount) ||
    outstandingAmount <= 0
  ) {
    const error = new Error(
      'There is no outstanding amount to pay.'
    );

    error.statusCode = 400;
    throw error;
  }

  const leasePeriodLabel =
    requestedYears > 1
      ? `${requestedYears} Years Advance Lease`
      : 'Monthly Rent';

  /*
   * Synchronize the payment record with the
   * selected payment period.
   */
  await pool.query(
    `
      UPDATE payments
      SET
        amount_due = $1,
        lease_period_label = $2,
        period_end =
          CURRENT_DATE +
          ($3 * INTERVAL '1 month') -
          INTERVAL '1 day'
      WHERE id = $4
    `,
    [
      targetAmountDue,
      leasePeriodLabel,
      requestedYears * 12,
      paymentId,
    ]
  );

  /*
   * Paystack expects the amount in kobo.
   */
  const amountInKobo =
    Math.round(outstandingAmount * 100);

  const reference =
    `FUG-${payment.id}-${Date.now()}`;

  /*
   * Build the callback URL.
   */
  let paystackCallbackUrl;

  if (callbackUrl) {
    try {
      const url = new URL(callbackUrl);

      url.searchParams.set(
        'payment_id',
        payment.id
      );

      paystackCallbackUrl = url.toString();
    } catch {
      paystackCallbackUrl = undefined;
    }
  }

  const initializeBody = {
    email: payment.tenant_email,
    amount: amountInKobo,
    currency: payment.currency || 'NGN',
    reference,
    metadata: {
      payment_id: payment.id,
      tenant_id: payment.tenant_id,
      tenant_name: payment.tenant_name,
      property_name: payment.property_name,
      years: requestedYears,
    },
  };

  if (paystackCallbackUrl) {
    initializeBody.callback_url =
      paystackCallbackUrl;
  }

  /*
   * Send transaction to Paystack.
   */
  const initializeRes = await fetch(
    `${PAYSTACK_API_URL}/transaction/initialize`,
    {
      method: 'POST',
      headers: {
        Authorization:
          `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(
        initializeBody
      ),
    }
  );

  const initializeData =
    await initializeRes.json();

  if (
    !initializeRes.ok ||
    !initializeData.status
  ) {
    console.error(
      'Paystack initialization failed:',
      initializeData
    );

    const error = new Error(
      initializeData.message ||
        'Paystack could not initialize the transaction.'
    );

    error.statusCode = 400;
    throw error;
  }

  /*
   * Store Paystack reference.
   */
  await pool.query(
    `
      UPDATE payments
      SET paystack_ref = $1
      WHERE id = $2
    `,
    [reference, payment.id]
  );

  return {
    payment_id: payment.id,
    reference:
      initializeData.data.reference,
    access_code:
      initializeData.data.access_code,
    authorization_url:
      initializeData.data.authorization_url,
    amount: outstandingAmount,
    currency:
      payment.currency || 'NGN',
  };
}

/*
 * ============================================================
 * GET ALL PAYMENTS
 * ============================================================
 */

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
      JOIN tenants t
        ON t.id = pay.tenant_id
      JOIN properties p
        ON p.id = t.property_id
      ORDER BY pay.created_at DESC
    `);

    res.json(result.rows);
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: 'Server error',
    });
  }
});

/*
 * ============================================================
 * CREATE PAYMENT RECORD
 * ============================================================
 */

router.post('/', async (req, res) => {
  try {
    const {
      tenant_id,
      amount_due,
      period_start,
      period_end,
      lease_period_label,
    } = req.body;

    if (
      !tenant_id ||
      !amount_due ||
      !period_start ||
      !period_end
    ) {
      return res.status(400).json({
        error:
          'tenant_id, amount_due, period_start and period_end are required',
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

    res.status(500).json({
      error: 'Server error',
    });
  }
});

/*
 * ============================================================
 * TENANT INITIALIZE PAYSTACK
 * ============================================================
 *
 * This is the endpoint used by the Tenant Portal.
 *
 * The tenant sends only:
 * - years
 * - callback URL
 *
 * The backend calculates the actual money amount.
 */

router.post(
  '/initialize-paystack',
  authenticate,
  requireRoles('TENANT'),
  async (req, res) => {
    try {
      const {
        years = 1,
        callback_url,
      } = req.body;

      /*
       * Find the tenant belonging to the logged-in user.
       *
       * IMPORTANT:
       * Use the linked tenant_id instead of matching
       * users and tenants by email.
       */
      const tenantResult = await pool.query(
        `
          SELECT
            t.id,
            t.rent_amount,
            t.rent_cycle,
            t.multi_year_eligible
          FROM users u
          JOIN tenants t
            ON t.id = u.tenant_id
          WHERE u.id = $1
            AND LOWER(u.role) = 'tenant'
          LIMIT 1
        `,
        [req.auth.id]
      );

      if (tenantResult.rows.length === 0) {
        return res.status(404).json({
          error:
            'Your tenant account could not be found.',
        });
      }

      const tenant =
        tenantResult.rows[0];

      /*
       * Look for an existing unpaid payment.
       */
      const existingPayment =
        await pool.query(
          `
            SELECT id
            FROM payments
            WHERE tenant_id = $1
              AND status != 'paid'
            ORDER BY created_at DESC
            LIMIT 1
          `,
          [tenant.id]
        );

      let paymentId;

      if (existingPayment.rows.length > 0) {
        paymentId =
          existingPayment.rows[0].id;
      } else {
        /*
         * Older tenants may not have a payment record.
         * Create one automatically.
         */
        const newPayment =
          await pool.query(
            `
              INSERT INTO payments (
                tenant_id,
                amount_due,
                amount_paid,
                status,
                period_start,
                period_end,
                lease_period_label
              )
              VALUES (
                $1,
                $2,
                0,
                'pending',
                CURRENT_DATE,
                CURRENT_DATE +
                  INTERVAL '1 month' -
                  INTERVAL '1 day',
                'Monthly Rent'
              )
              RETURNING id
            `,
            [
              tenant.id,
              Math.round(
                Number(tenant.rent_amount)
              ),
            ]
          );

        paymentId =
          newPayment.rows[0].id;
      }

      const result =
        await initializePaystackTransaction({
          paymentId,
          years,
          callbackUrl: callback_url,
        });

      return res.json(result);
    } catch (err) {
      console.error(
        'TENANT PAYSTACK INITIALIZATION ERROR:',
        err
      );

      return res.status(
        err.statusCode || 500
      ).json({
        error:
          err.message ||
          'Server error while initializing payment.',
      });
    }
  }
);

/*
 * ============================================================
 * LEGACY / PAYMENT-ID PAYSTACK INITIALIZATION
 * ============================================================
 */

router.post(
  '/:id/initialize-paystack',
  async (req, res) => {
    try {
      const {
        years = 1,
        callback_url,
      } = req.body || {};

      const result =
        await initializePaystackTransaction({
          paymentId: req.params.id,
          years,
          callbackUrl: callback_url,
        });

      res.json(result);
    } catch (err) {
      console.error(
        'Paystack initialization error:',
        err
      );

      res.status(
        err.statusCode || 500
      ).json({
        error:
          err.message ||
          'Server error while initializing payment.',
      });
    }
  }
);

/*
 * ============================================================
 * COMPLETE PAYMENT
 * ============================================================
 */

async function completePayment(
  client,
  paymentId,
  amountPaid,
  paystackRef
) {
  const receiptNumber =
    `REC-FUG-${Date.now()
      .toString()
      .slice(-8)}`;

  const paymentResult =
    await client.query(
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
      [
        amountPaid,
        paystackRef,
        receiptNumber,
        paymentId,
      ]
    );

  if (paymentResult.rows.length === 0) {
    return null;
  }

  const payment =
    paymentResult.rows[0];

  const infoResult =
    await client.query(
      `
        SELECT
          t.name AS tenant_name,
          t.email AS tenant_email,
          p.name AS property_name,
          p.agent_id,
          a.commission_rate
        FROM tenants t
        JOIN properties p
          ON p.id = t.property_id
        LEFT JOIN agents a
          ON a.id = p.agent_id
        WHERE t.id = $1
      `,
      [payment.tenant_id]
    );

  const info =
    infoResult.rows[0];

  /*
   * Create agent commission.
   */
  if (
    info?.agent_id &&
    info?.commission_rate != null
  ) {
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

  /*
   * Send receipt email.
   */
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
 * ============================================================
 * VERIFY PAYSTACK PAYMENT
 * ============================================================
 */

router.post(
  '/:id/verify-paystack',
  authenticate,
  requireRoles('TENANT', 'ADMIN'),
  async (req, res) => {
    const client =
      await pool.connect();

    try {
      if (!process.env.PAYSTACK_SECRET_KEY) {
        return res.status(500).json({
          error:
            'Paystack is not configured on the server.',
        });
      }

      const { reference } =
        req.body;

      if (!reference) {
        return res.status(400).json({
          error:
            'Missing payment reference.',
        });
      }

      const paymentResult =
        await client.query(
          `
            SELECT *
            FROM payments
            WHERE id = $1
            LIMIT 1
          `,
          [req.params.id]
        );

      if (
        paymentResult.rows.length === 0
      ) {
        return res.status(404).json({
          error:
            'Payment record not found.',
        });
      }

      const paymentRecord =
        paymentResult.rows[0];

      /*
       * Prevent a tenant from verifying
       * somebody else's payment.
       *
       * Use users.tenant_id rather than
       * matching by email.
       */
      if (
        String(req.auth.role).toLowerCase() ===
        'tenant'
      ) {
        const ownershipResult =
          await client.query(
            `
              SELECT 1
              FROM users u
              JOIN tenants t
                ON t.id = u.tenant_id
              JOIN payments p
                ON p.tenant_id = t.id
              WHERE u.id = $1
                AND p.id = $2
              LIMIT 1
            `,
            [
              req.auth.id,
              req.params.id,
            ]
          );

        if (
          ownershipResult.rows.length === 0
        ) {
          return res.status(403).json({
            error:
              'You cannot verify this payment.',
          });
        }
      }

      if (
        paymentRecord.status === 'paid'
      ) {
        return res.status(409).json({
          error:
            'This payment was already recorded.',
        });
      }

      if (
        paymentRecord.paystack_ref &&
        paymentRecord.paystack_ref !==
          reference
      ) {
        return res.status(400).json({
          error:
            'Payment reference does not match this payment.',
        });
      }

      /*
       * Verify directly with Paystack.
       */
      const verifyRes =
        await fetch(
          `${PAYSTACK_API_URL}/transaction/verify/${encodeURIComponent(
            reference
          )}`,
          {
            headers: {
              Authorization:
                `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
            },
          }
        );

      const verifyData =
        await verifyRes.json();

      if (
        !verifyRes.ok ||
        !verifyData.status ||
        verifyData.data?.status !==
          'success'
      ) {
        console.error(
          'Paystack verification failed:',
          verifyData
        );

        return res.status(400).json({
          error:
            'Payment could not be verified.',
        });
      }

      const amountPaid =
        Number(
          verifyData.data.amount
        ) / 100;

      const expectedAmount =
        Number(
          paymentRecord.amount_due
        ) -
        Number(
          paymentRecord.amount_paid || 0
        );

      const expectedKobo =
        Math.round(
          expectedAmount * 100
        );

      const actualKobo =
        Number(
          verifyData.data.amount
        );

      /*
       * Never accept an amount different
       * from what the database expects.
       */
      if (
        actualKobo !== expectedKobo
      ) {
        console.error(
          'Payment amount mismatch:',
          {
            paymentId:
              paymentRecord.id,
            expectedKobo,
            actualKobo,
            reference,
          }
        );

        return res.status(400).json({
          error:
            'Payment amount does not match the outstanding amount.',
        });
      }

      await client.query(
        'BEGIN'
      );

      const payment =
        await completePayment(
          client,
          req.params.id,
          amountPaid,
          reference
        );

      if (!payment) {
        await client.query(
          'ROLLBACK'
        );

        return res.status(409).json({
          error:
            'This payment was already recorded.',
        });
      }

      await client.query(
        'COMMIT'
      );

      res.json(payment);
    } catch (err) {
      try {
        await client.query(
          'ROLLBACK'
        );
      } catch (
        rollbackError
      ) {
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
        error:
          'Server error while verifying payment.',
      });
    } finally {
      client.release();
    }
  }
);

/*
 * ============================================================
 * MANUAL MARK PAID
 * ============================================================
 */

router.post(
  '/:id/mark-paid',
  async (req, res) => {
    const client =
      await pool.connect();

    try {
      const {
        amount_paid,
        paystack_ref,
      } = req.body;

      if (
        amount_paid === undefined ||
        amount_paid === null
      ) {
        return res.status(400).json({
          error:
            'amount_paid is required.',
        });
      }

      await client.query(
        'BEGIN'
      );

      const payment =
        await completePayment(
          client,
          req.params.id,
          amount_paid,
          paystack_ref ||
            'manual'
        );

      if (!payment) {
        await client.query(
          'ROLLBACK'
        );

        return res.status(409).json({
          error:
            'This payment was already recorded.',
        });
      }

      await client.query(
        'COMMIT'
      );

      res.json(payment);
    } catch (err) {
      try {
        await client.query(
          'ROLLBACK'
        );
      } catch (
        rollbackError
      ) {
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
  }
);

module.exports = router;