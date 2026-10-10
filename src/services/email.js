async function sendEmail({ to, subject, html }) {
  if (!process.env.RESEND_API_KEY) {
    console.error('Email not sent: RESEND_API_KEY is missing.');
    return;
  }

  if (!to) {
    console.error('Email not sent: recipient address is missing.');
    return;
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM || 'onboarding@resend.dev',
        to,
        subject,
        html,
      }),
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      console.error('Resend email failed:', {
        status: response.status,
        error: result,
      });
      return;
    }

    console.log('Resend email accepted:', {
      to,
      subject,
      id: result.id,
    });
  } catch (err) {
    console.error('Failed to send email:', err.message);
  }
}

async function sendReceiptEmail({
  to,
  tenantName,
  amount,
  propertyName,
  period,
}) {
  await sendEmail({
    to,
    subject: `Payment received - ${propertyName}`,
    html: `
      <p>Hi ${tenantName},</p>
      <p>
        We've received your rent payment of
        <strong>&#8358;${Number(amount).toLocaleString()}</strong>
        for <strong>${propertyName}</strong>,
        covering <strong>${period}</strong>.
      </p>
      <p>Thank you.</p>
      <p>PropertyPro</p>
    `,
  });
}

async function sendComplaintEmail({
  to,
  recipientName,
  subject,
  complaintSubject,
  message,
}) {
  await sendEmail({
    to,
    subject,
    html: `
      <p>Hi ${recipientName},</p>
      <p>${message}</p>
      <p><strong>Complaint:</strong> ${complaintSubject}</p>
      <p>PropertyPro</p>
    `,
  });
}

module.exports = {
  sendEmail,
  sendReceiptEmail,
  sendComplaintEmail,
};