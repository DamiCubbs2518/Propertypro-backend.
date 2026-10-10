const pool = require('../db');
const { sendEmail } = require('./email');

async function createNotification({
  recipientUserId,
  type,
  title,
  message,
  relatedId = null,
}) {
  const result = await pool.query(
    `INSERT INTO notifications
      (recipient_user_id, type, title, message, related_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [recipientUserId, type, title, message, relatedId]
  );

  return result.rows[0];
}

async function notifyAdmins({
  type,
  title,
  message,
  relatedId = null,
  emailSubject,
  emailMessage,
}) {
  const result = await pool.query(
    `SELECT id, name, email
     FROM users
     WHERE LOWER(role) = 'admin'`
  );

  for (const admin of result.rows) {
    await createNotification({
      recipientUserId: admin.id,
      type,
      title,
      message,
      relatedId,
    });

    if (admin.email) {
      await sendEmail({
        to: admin.email,
        subject: emailSubject || title,
        html: `
          <p>Hi ${admin.name || 'Admin'},</p>
          <p>${emailMessage || message}</p>
          <p>— PropertyPro</p>
        `,
      });
    }
  }
}

async function notifyTenantByTenantId({
  tenantId,
  type,
  title,
  message,
  relatedId = null,
  emailSubject,
  emailMessage,
}) {
  const result = await pool.query(
    `SELECT u.id, u.name, u.email
     FROM users u
     JOIN tenants t
       ON LOWER(u.email) = LOWER(t.email)
     WHERE t.id = $1
       AND LOWER(u.role) = 'tenant'
     LIMIT 1`,
    [tenantId]
  );

  if (result.rows.length === 0) return null;

  const tenant = result.rows[0];

  const notification = await createNotification({
    recipientUserId: tenant.id,
    type,
    title,
    message,
    relatedId,
  });

  if (tenant.email) {
    await sendEmail({
      to: tenant.email,
      subject: emailSubject || title,
      html: `
        <p>Hi ${tenant.name || 'Tenant'},</p>
        <p>${emailMessage || message}</p>
        <p>— PropertyPro</p>
      `,
    });
  }

  return notification;
}

module.exports = {
  createNotification,
  notifyAdmins,
  notifyTenantByTenantId,
};