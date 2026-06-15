export async function onRequestPost(context) {
  const { request, env } = context;
  
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, X-Staff-Passcode",
    "Content-Type": "application/json",
  };

  // Enforce passcode check if STAFF_PASSCODE is set in the environment
  const passcode = request.headers.get("X-Staff-Passcode");
  if (env.STAFF_PASSCODE && passcode !== env.STAFF_PASSCODE) {
    return new Response(JSON.stringify({ message: "Unauthorized: Invalid or missing staff passcode" }), {
      status: 401,
      headers: corsHeaders,
    });
  }

  const { order_number, amount, customer_name, customer_email, attachment, attachments } = await request.json();

  if (!order_number || !amount || !customer_name || !customer_email) {
    return new Response(JSON.stringify({ message: "Missing required fields" }), {
      status: 400,
      headers: corsHeaders,
    });
  }

  // 1. Insert record into Supabase bypassing RLS with service_role key
  const supabaseRes = await fetch(`${env.SUPABASE_URL}/rest/v1/payment_links`, {
    method: "POST",
    headers: {
      "apikey": env.SUPABASE_SERVICE_ROLE_KEY,
      "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      "Prefer": "return=representation",
    },
    body: JSON.stringify({
      order_number,
      amount,
      customer_name,
      customer_email,
      status: "pending",
    }),
  });

  if (!supabaseRes.ok) {
    const errText = await supabaseRes.text();
    return new Response(JSON.stringify({ message: "Database insert failed", details: errText }), {
      status: 502,
      headers: corsHeaders,
    });
  }

  const records = await supabaseRes.json();
  const uuid = records[0].id;

  const baseDomain = new URL(request.url).origin;
  const paymentLinkUrl = `${baseDomain}/pay/${uuid}`;
  // Parse customer name, company name, and job description
  const customerNameRaw = customer_name || '';
  let customerName = customerNameRaw;
  let companyName = '';

  const nameMatch = customerNameRaw.match(/^(.*?)(?:\s*\((.*?)\))?(?:\s*\[Job:[^\]]*\])?$/);
  if (nameMatch) {
    customerName = nameMatch[1] ? nameMatch[1].trim() : '';
    companyName = nameMatch[2] ? nameMatch[2].trim() : '';
  }

  // 2. Email customer invoice link via Resend
  const resendEmailBody = {
    from: "Overnight Printing Seattle <accounting@overnightprintingseattle.com>",
    to: [customer_email],
    subject: `Invoice Payment Request: Invoice #${order_number}`,
    html: `
      <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 600px; margin: 0 auto; padding: 32px; border: 1px solid #e2e1e8; border-radius: 16px; background-color: #ffffff; color: #1f2937;">
        <div style="text-align: center; margin-bottom: 24px;">
          <img src="https://pay.overnightprintingseattle.com/logo.png" alt="Overnight Printing Seattle" style="max-height: 60px; width: auto;" />
        </div>
        <h2 style="color: #1e2f66; margin-top: 0; font-size: 24px; font-weight: 700; letter-spacing: -0.02em;">Invoice Payment Request</h2>
        <p style="font-size: 16px; line-height: 1.5; color: #4b5563;">Hello ${customerName},</p>
        ${companyName ? `<p style="font-size: 16px; line-height: 1.5; color: #4b5563;">A secure payment link has been created for ${companyName} print order with Overnight Printing Seattle.</p>` : `<p style="font-size: 16px; line-height: 1.5; color: #4b5563;">A secure payment link has been created for your print order with Overnight Printing Seattle.</p>`}
        
        <div style="background-color: #f3f4f6; border-radius: 12px; padding: 20px; margin: 24px 0;">
          <table style="width: 100%; border-collapse: collapse; font-size: 15px;">
            <tr>
              <td style="padding: 6px 0; color: #6b7280;">Invoice Number:</td>
              <td style="padding: 6px 0; font-weight: 600; text-align: right;">#${order_number}</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #6b7280; border-top: 1px dashed #e5e7eb;">Customer Name:</td>
              <td style="padding: 6px 0; font-weight: 600; text-align: right; border-top: 1px dashed #e5e7eb;">${customerName}</td>
            </tr>
            ${companyName ? `
            <tr>
              <td style="padding: 6px 0; color: #6b7280; border-top: 1px dashed #e5e7eb;">Company Name:</td>
              <td style="padding: 6px 0; font-weight: 600; text-align: right; border-top: 1px dashed #e5e7eb;">${companyName}</td>
            </tr>
            ` : ''}

            <tr>
              <td style="padding: 6px 0; color: #6b7280; border-top: 1px dashed #e5e7eb;">Amount Due:</td>
              <td style="padding: 6px 0; font-weight: 700; font-size: 18px; text-align: right; color: #111827; border-top: 1px dashed #e5e7eb;">$${parseFloat(amount).toFixed(2)} USD</td>
            </tr>
          </table>
        </div>
        
        <div style="text-align: center; margin: 32px 0;">
          <a href="${paymentLinkUrl}" style="background-color: #1e2f66; color: #ffffff; padding: 14px 28px; text-decoration: none; font-weight: 600; font-size: 16px; border-radius: 10px; display: inline-block;">Pay Invoice</a>
        </div>
        
        <p style="font-size: 13px; color: #9ca3af; text-align: center; margin-bottom: 0;">
          If the button above does not work, copy and paste this URL into your browser:<br/>
          <a href="${paymentLinkUrl}" style="color: #1e2f66; word-break: break-all;">${paymentLinkUrl}</a>
        </p>
        <hr style="border: 0; border-top: 1px solid #e5e7eb; margin: 32px 0;" />
        <p style="font-size: 12px; color: #9ca3af; text-align: center; margin-bottom: 0;">
          Questions? Contact us at <a href="mailto:contact@overnightprintingseattle.com" style="color: #1e2f66;">contact@overnightprintingseattle.com</a>
        </p>
      </div>
    `,
  };

  if (attachments && Array.isArray(attachments)) {
    resendEmailBody.attachments = attachments
      .filter(att => att && att.content && att.filename)
      .map(att => ({
        content: att.content,
        filename: att.filename,
      }));
  } else if (attachment && attachment.content && attachment.filename) {
    resendEmailBody.attachments = [
      {
        content: attachment.content,
        filename: attachment.filename,
      }
    ];
  }

  const resendRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(resendEmailBody),
  });

  const emailSent = resendRes.ok;

  if (emailSent) {
    const confirmationEmailBody = {
      from: "Overnight Printing Seattle <accounting@overnightprintingseattle.com>",
      to: ["accounting@overnightprintingseattle.com"],
      subject: `[Sent] Invoice Payment Link Created - Invoice #${order_number}`,
      html: `
        <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e1e8; border-radius: 12px; background-color: #f9fafb; color: #111827;">
          <h2 style="color: #1e2f66; margin-top: 0; font-size: 20px; font-weight: 700; border-bottom: 2px solid #e5e7eb; padding-bottom: 12px;">Invoice Link Sent (Internal Confirmation)</h2>
          <p style="font-size: 14px; color: #4b5563; line-height: 1.5;">A payment link has been generated and emailed to the customer successfully.</p>
          <table style="width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 15px;">
            <tr>
              <td style="padding: 8px 0; color: #4b5563; font-weight: 500;">Invoice Number(s):</td>
              <td style="padding: 8px 0; font-weight: 600;">#${order_number}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #4b5563; font-weight: 500;">Total Amount:</td>
              <td style="padding: 8px 0; font-weight: 700; color: #1e2f66; font-size: 16px;">$${parseFloat(amount).toFixed(2)} USD</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #4b5563; font-weight: 500;">Customer Name:</td>
              <td style="padding: 8px 0;">${customerName}</td>
            </tr>
            ${companyName ? `
            <tr>
              <td style="padding: 8px 0; color: #4b5563; font-weight: 500;">Company Name:</td>
              <td style="padding: 8px 0; font-weight: 600;">${companyName}</td>
            </tr>
            ` : ''}
            <tr>
              <td style="padding: 8px 0; color: #4b5563; font-weight: 500;">Customer Email:</td>
              <td style="padding: 8px 0;"><a href="mailto:${customer_email}" style="color: #1e2f66; text-decoration: none;">${customer_email}</a></td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #4b5563; font-weight: 500; border-top: 1px dashed #d1d5db;">Payment Link URL:</td>
              <td style="padding: 8px 0; border-top: 1px dashed #d1d5db;"><a href="${paymentLinkUrl}" style="color: #1e2f66; text-decoration: none; word-break: break-all;">${paymentLinkUrl}</a></td>
            </tr>
          </table>
        </div>
      `,
    };

    context.waitUntil(
      fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(confirmationEmailBody),
      }).catch(err => console.error("Async confirmation email failed:", err))
    );
  }

  return new Response(JSON.stringify({ id: uuid, email_sent: emailSent }), {
    status: 200,
    headers: corsHeaders,
  });
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Staff-Passcode",
    }
  });
}
