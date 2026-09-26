// Sends a simple payment receipt email via Resend's API.
// Uses built-in fetch — no extra package needed.

async function sendReceiptEmail({ to, tenantName, amount, propertyName, period }) {
  if (!process.env.RESEND_API_KEY || !to) return; // silently skip if not configured

  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM || 'onboarding@resend.dev',
        to,
        subject: `Payment received — ${propertyName}`,
        html: `
          <p>Hi ${tenantName},</p>
          <p>We've received your rent payment of <strong>₦${Number(amount).toLocaleString()}</strong>
          for <strong>${propertyName}</strong>, covering <strong>${period}</strong>.</p>
          <p>Thank you.</p>
          <p>— PropertyPro</p>
        `,
      }),
    });
  } catch (err) {
    console.error('Failed to send receipt email:', err.message);
  }
}

module.exports = { sendReceiptEmail };
