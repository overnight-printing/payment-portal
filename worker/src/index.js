// Cloudflare Worker backend for Overnight Printing Seattle Payment Portal
// Handles secure Supabase updates (bypassing RLS with service_role), Resend emails, and CardPointe charges.

function getPaymentLast4(cpResult, token) {
  const last4Candidates = [
    cpResult?.last4,
    cpResult?.acctlast4,
    cpResult?.accountlast4,
    cpResult?.cardlast4,
    cpResult?.token?.slice?.(-4),
    cpResult?.account?.slice?.(-4),
    token?.slice?.(-4),
  ];
  const last4 = last4Candidates
    .map((value) => String(value || "").replace(/\D/g, "").slice(-4))
    .find((value) => value.length === 4) || "****";

  return last4;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");

    // 1. CORS Preflight & Headers Setup
    const corsHeaders = {
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Staff-Passcode",
      "Access-Control-Max-Age": "86400",
    };

    // Dynamically allow pay.overnightprintingseattle.com and localhost
    const allowedOrigins = [
      "https://pay.overnightprintingseattle.com",
      "http://localhost:5173", // default vite dev server
    ];

    if (origin && (allowedOrigins.includes(origin) || origin.startsWith("http://localhost:"))) {
      corsHeaders["Access-Control-Allow-Origin"] = origin;
    } else {
      // Default fallback
      corsHeaders["Access-Control-Allow-Origin"] = "https://pay.overnightprintingseattle.com";
    }

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    // Ensure only GET and POST methods are allowed
    if (request.method !== "POST" && request.method !== "GET") {
      return new Response(JSON.stringify({ message: "Method Not Allowed" }), {
        status: 405,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    try {
      // 2. ROUTING
      if (url.pathname === "/payment-link" && request.method === "GET") {
        return await handleGetLink(request, env, corsHeaders);
      } else if (url.pathname === "/create-link" && request.method === "POST") {
        const passcode = request.headers.get("X-Staff-Passcode");
        if (env.STAFF_PASSCODE && passcode !== env.STAFF_PASSCODE) {
          return new Response(JSON.stringify({ message: "Unauthorized: Invalid or missing staff passcode" }), {
            status: 401,
            headers: { "Content-Type": "application/json", ...corsHeaders },
          });
        }
        return await handleCreateLink(request, env, ctx, corsHeaders);
      } else if (url.pathname === "/charge" && request.method === "POST") {
        return await handleCharge(request, env, ctx, corsHeaders);
      } else if (url.pathname === "/analyze-invoice" && request.method === "POST") {
        const passcode = request.headers.get("X-Staff-Passcode");
        if (env.STAFF_PASSCODE && passcode !== env.STAFF_PASSCODE) {
          return new Response(JSON.stringify({ message: "Unauthorized: Invalid or missing staff passcode" }), {
            status: 401,
            headers: { "Content-Type": "application/json", ...corsHeaders },
          });
        }
        return await handleAnalyzeInvoice(request, env, corsHeaders);
      } else {
        return new Response(JSON.stringify({ message: "Not Found" }), {
          status: 404,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      }
    } catch (error) {
      console.error("Worker Global Error:", error);
      return new Response(
        JSON.stringify({ message: "Internal Server Error", error: error.message }),
        {
          status: 500,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        }
      );
    }
  },
};

/**
 * Handles fetching payment link details securely from Supabase using the service_role key.
 */
async function handleGetLink(request, env, corsHeaders) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id");

  if (!id) {
    return new Response(JSON.stringify({ message: "Missing id parameter" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  // Fetch record from Supabase bypassing RLS with service_role key
  const supabaseRes = await fetch(`${env.SUPABASE_URL}/rest/v1/payment_links?id=eq.${id}`, {
    method: "GET",
    headers: {
      "apikey": env.SUPABASE_SERVICE_ROLE_KEY,
      "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    },
  });

  if (!supabaseRes.ok) {
    const errText = await supabaseRes.text();
    console.error("Supabase select error:", errText);
    return new Response(
      JSON.stringify({ message: "Failed to retrieve invoice from database" }),
      {
        status: 502,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }

  const records = await supabaseRes.json();
  
  if (!records || records.length === 0) {
    return new Response(
      JSON.stringify({ message: "Payment link not found or has expired." }),
      {
        status: 404,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }

  return new Response(JSON.stringify(records[0]), {
    status: 200,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

/**
 * Handles creating a payment link record in Supabase and emailing the link via Resend.
 */
async function handleCreateLink(request, env, ctx, corsHeaders) {
  const { order_number, amount, customer_name, customer_email, attachment, attachments, send_email } = await request.json();

  if (!order_number || !amount || !customer_name || !customer_email) {
    return new Response(JSON.stringify({ message: "Missing required fields" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  // 1. Insert pending record into Supabase using service_role key
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
    console.error("Supabase insert error:", errText);
    return new Response(
      JSON.stringify({ message: "Failed to create invoice in database", details: errText }),
      {
        status: 502,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }

  const records = await supabaseRes.json();
  const createdRecord = records[0];
  const uuid = createdRecord.id;

  // Parse customer name and company name
  const customerNameRaw = customer_name || '';
  let customerName = customerNameRaw;
  let companyName = '';

  const nameMatch = customerNameRaw.match(/^(.*?)(?:\s*\((.*?)\))?$/);
  if (nameMatch) {
    customerName = nameMatch[1] ? nameMatch[1].trim() : '';
    companyName = nameMatch[2] ? nameMatch[2].trim() : '';
  }

  const isLocal = request.headers.get("Origin")?.includes("localhost");
  const baseDomain = isLocal ? request.headers.get("Origin") : "https://pay.overnightprintingseattle.com";
  const paymentLinkUrl = `${baseDomain}/pay/${uuid}`;

  let emailSent = false;

  if (send_email !== false) {
    // 2. Send client email via Resend
    const resendEmailBody = {
      from: "Overnight Printing Seattle <accounting@overnightprintingseattle.com>",
      to: [customer_email],
      subject: `Invoice Payment Request: Order #${order_number}`,
      html: `
        <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 600px; margin: 0 auto; padding: 32px; border: 1px solid #e2e1e8; border-radius: 16px; background-color: #ffffff; color: #1f2937;">
          <div style="text-align: center; margin-bottom: 24px;">
            <img src="https://pay.overnightprintingseattle.com/logo.png" alt="Overnight Printing Seattle" style="max-height: 60px; width: auto;" />
          </div>
          <h2 style="color: #1e2f66; margin-top: 0; font-size: 24px; font-weight: 700; letter-spacing: -0.02em;">Invoice Payment Request</h2>
          <p style="font-size: 16px; line-height: 1.5; color: #4b5563;">Hello ${customerName},</p>
          <p style="font-size: 16px; line-height: 1.5; color: #4b5563;">A secure payment link has been created for your print order with Overnight Printing Seattle.</p>
          
          <div style="background-color: #f3f4f6; border-radius: 12px; padding: 20px; margin: 24px 0;">
            <table style="width: 100%; border-collapse: collapse; font-size: 15px;">
              <tr>
                <td style="padding: 6px 0; color: #6b7280;">Order Number:</td>
                <td style="padding: 6px 0; font-weight: 600; text-align: right;">#${order_number}</td>
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

    emailSent = resendRes.ok;

    if (emailSent) {
      const confirmationEmailBody = {
        from: "Overnight Printing Seattle <accounting@overnightprintingseattle.com>",
        to: ["accounting@overnightprintingseattle.com"],
        subject: `[Sent] Invoice Payment Link Created - Invoice #${order_number}`,
        html: `
          <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e1e8; border-radius: 12px; background-color: #f9fafb; color: #111827;">
            <div style="text-align: center; margin-bottom: 24px;">
              <img src="https://pay.overnightprintingseattle.com/logo.png" alt="Overnight Printing Seattle" style="max-height: 60px; width: auto;" />
            </div>
            <h2 style="color: #1e2f66; margin-top: 0; font-size: 20px; font-weight: 700; border-bottom: 2px solid #e5e7eb; padding-bottom: 12px;">Invoice Link Sent</h2>
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

      ctx.waitUntil(
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

    if (!emailSent) {
      const resendErr = await resendRes.text();
      console.error("Resend API error:", resendErr);
      return new Response(
        JSON.stringify({ 
          id: uuid, 
          email_sent: false, 
          warning: "Payment link created, but customer email failed to send." 
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        }
      );
    }
  }

  return new Response(JSON.stringify({ id: uuid, email_sent: emailSent }), {
    status: 200,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

/**
 * Handles charging the tokenized card via CardPointe and updating the Supabase state + notifying internal staff.
 */
async function handleCharge(request, env, ctx, corsHeaders) {
  const { token, amount, expiry, cvv2, zip, paymentLinkId } = await request.json();

  if (!token || !amount || !expiry || !cvv2 || !zip || !paymentLinkId) {
    return new Response(JSON.stringify({ message: "Missing transaction parameters" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  // 0.5 Verify invoice amount and status against Database securely
  const verifyRes = await fetch(`${env.SUPABASE_URL}/rest/v1/payment_links?id=eq.${paymentLinkId}`, {
    method: "GET",
    headers: {
      "apikey": env.SUPABASE_SERVICE_ROLE_KEY,
      "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    },
  });

  if (!verifyRes.ok) {
    return new Response(JSON.stringify({ message: "Failed to verify invoice details with the database." }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  const verifyRecords = await verifyRes.json();
  if (!verifyRecords || verifyRecords.length === 0) {
    return new Response(JSON.stringify({ message: "Invoice not found or expired." }), {
      status: 404,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  const invoice = verifyRecords[0];

  // Prevent double charging
  if (invoice.status === "paid") {
    return new Response(JSON.stringify({ message: "This invoice has already been paid." }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  // Prevent amount tampering
  const dbAmount = parseFloat(invoice.amount);
  const reqAmount = parseFloat(amount);
  if (Math.abs(dbAmount - reqAmount) > 0.01) {
    console.error(`Worker - Amount mismatch! DB: ${dbAmount}, Request: ${reqAmount}`);
    return new Response(JSON.stringify({ message: "Payment amount mismatch detected. Please refresh the page and try again." }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  // 1. Process with CardPointe
  let cpResult;
  // Security Fix: Removed the hardcoded 0.07 backdoor. Only allow mock if explicitly enabled in ENV.
  const isMockPayment = env.MOCK_PAYMENT === "true";

  if (isMockPayment) {
    console.log("Worker - Mock payment mode triggered. Bypassing CardPointe Gateway.");
    cpResult = {
      respstat: "A",
      retref: "MOCK-" + Math.floor(Math.random() * 899999 + 100000),
      resptext: "Approval",
      respcode: "00",
    };
  } else {
    const auth = btoa(`${env.CARDPOINTE_USER}:${env.CARDPOINTE_PASS}`);
    const cardpointeBody = {
      merchid: env.CARDPOINTE_MID,
      account: token,
      amount: amount,
      expiry: expiry,
      cvv2: cvv2,
      postal: zip,
      currency: "USD",
      capture: "Y",
    };

    const cpRes = await fetch("https://fts.cardconnect.com/cardconnect/rest/auth", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Basic ${auth}`,
      },
      body: JSON.stringify(cardpointeBody),
    });

    if (!cpRes.ok) {
      const cpErr = await cpRes.text();
      console.error("CardPointe connection error:", cpErr);
      return new Response(JSON.stringify({ message: "Credit card gateway connection failed" }), {
        status: 502,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    cpResult = await cpRes.json();
  }

  // respstat === 'A' -> Approved
  // respstat === 'B' -> Retry (Soft decline)
  // respstat === 'C' -> Hard Decline
  if (cpResult.respstat !== "A") {
    const declineMsg = cpResult.resptext || "Card declined. Please check details and try again.";
    return new Response(JSON.stringify({ message: declineMsg, code: cpResult.respcode }), {
      status: 402, // Payment Required
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  const retref = cpResult.retref;
  const paidAt = new Date().toISOString();

  // 2. Update Supabase record using service_role to flip status to 'paid'
  const supabaseRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/payment_links?id=eq.${paymentLinkId}`,
    {
      method: "PATCH",
      headers: {
        "apikey": env.SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        "Prefer": "return=representation",
      },
      body: JSON.stringify({
        status: "paid",
        paid_at: paidAt,
        retref: retref,
      }),
    }
  );

  if (!supabaseRes.ok) {
    const sbErr = await supabaseRes.text();
    console.error("Supabase patch error:", sbErr);
    // Note: Payment succeeded in CardPointe, but DB update failed.
    // Return status 500 but include retref so staff can reconcile manually.
    return new Response(
      JSON.stringify({
        message: "Payment authorized, but failed to update status in database. Please contact support.",
        retref: retref,
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }

  const records = await supabaseRes.json();
  const updatedRecord = records[0];

  // Parse customer name and company name
  const customerNameRaw = updatedRecord.customer_name || '';
  let customerName = customerNameRaw;
  let companyName = '';

  const nameMatch = customerNameRaw.match(/^(.*?)(?:\s*\((.*?)\))?$/);
  if (nameMatch) {
    customerName = nameMatch[1] ? nameMatch[1].trim() : '';
    companyName = nameMatch[2] ? nameMatch[2].trim() : '';
  }

  // 3. Send Internal Notification Email to staff via Resend
  const formattedPaidAt = new Date(paidAt).toLocaleString("en-US", {
    timeZone: "America/Los_Angeles",
    dateStyle: "medium",
    timeStyle: "medium",
  });

  const last4 = getPaymentLast4(cpResult, token);

  const staffEmailBody = {
    from: "Billing Alerts <accounting@overnightprintingseattle.com>",
    to: ["accounting@overnightprintingseattle.com", "contact@overnightprintingseattle.com"],
    subject: `[Paid] Invoice #${updatedRecord.order_number} - $${parseFloat(amount).toFixed(2)}`,
    html: `
      <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e1e8; border-radius: 12px; background-color: #f9fafb; color: #111827;">
        <div style="text-align: center; margin-bottom: 24px;">
          <img src="https://pay.overnightprintingseattle.com/logo.png" alt="Overnight Printing Seattle" style="max-height: 60px; width: auto;" />
        </div>
        <h2 style="color: #059669; margin-top: 0; font-size: 20px; font-weight: 700; border-bottom: 2px solid #e5e7eb; padding-bottom: 12px;">Payment Completion Alert</h2>
        <table style="width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 15px;">
          <tr>
            <td style="padding: 8px 0; color: #4b5563; font-weight: 500;">Invoice Number:</td>
            <td style="padding: 8px 0; font-weight: 600;">#${updatedRecord.order_number}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #4b5563; font-weight: 500;">Amount Paid:</td>
            <td style="padding: 8px 0; font-weight: 700; color: #059669; font-size: 16px;">$${parseFloat(amount).toFixed(2)} USD</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #4b5563; font-weight: 500;">Payment Method:</td>
            <td style="padding: 8px 0; font-weight: 600;">Credit Card ending in ${last4}</td>
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
            <td style="padding: 8px 0;"><a href="mailto:${updatedRecord.customer_email}" style="color: #1e2f66; text-decoration: none;">${updatedRecord.customer_email}</a></td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #4b5563; font-weight: 500;">Payment Date:</td>
            <td style="padding: 8px 0;">${formattedPaidAt} (PST)</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #4b5563; font-weight: 500; border-top: 1px dashed #d1d5db;">CardPointe Reference Number:</td>
            <td style="padding: 8px 0; font-weight: 600; font-family: monospace; border-top: 1px dashed #d1d5db;">${retref}</td>
          </tr>
        </table>
      </div>
    `,
  };

  // Dispatch email asynchronously so it doesn't delay the successful response to the customer.
  ctx.waitUntil(
    fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(staffEmailBody),
    }).then(res => {
      if (!res.ok) {
        res.text().then(txt => console.error("Async Resend Internal Alert Failure:", txt));
      }
    }).catch(err => {
      console.error("Async Resend Internal Alert Exception:", err);
    })
  );

  return new Response(JSON.stringify({ success: true, retref: retref }), {
    status: 200,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

/**
 * Helper to convert ArrayBuffer to base64 in JS.
 */
function arrayBufferToBase64(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Deterministic parser for Overnight Printing Seattle invoice text.
 */
function parseInvoiceText(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim());

  let order_number = "";
  let customer_name = "";
  let company_name = "";
  let customer_email = "";
  let amount = "";
  let total = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // --- Order Number ---
    const sameLineNo = line.match(/^No:\s*(\d+)/i);
    if (sameLineNo && !order_number) {
      order_number = sameLineNo[1];
    } else if (line === "No:" && !order_number) {
      for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
        if (lines[j].trim()) {
          order_number = lines[j].trim().replace(/\D/g, "");
          break;
        }
      }
    }

    // --- Ship To block: customer name, company name, email ---
    if (line === "Ship To:" && !customer_name) {
      let shipLines = [];
      for (let j = i + 1; j < Math.min(i + 8, lines.length); j++) {
        const sl = lines[j].trim();
        if (!sl) continue;
        if (/^(Quantity|Description|Amount|Taken by)$/i.test(sl)) break;
        shipLines.push(sl);
      }

      const emailLine = shipLines.find(l => l.toLowerCase().includes("e-mail:") || l.toLowerCase().includes("email:"));
      if (emailLine) {
        customer_email = emailLine.replace(/^e-mail:\s*/i, "").replace(/^email:\s*/i, "").trim();
      }

      const nonEmail = shipLines.filter(l => !l.toLowerCase().includes("e-mail:") && !l.toLowerCase().includes("email:"));
      if (nonEmail[0]) customer_name = nonEmail[0];
      if (nonEmail[1]) company_name = nonEmail[1];
    }

    // --- Amount Due (primary) ---
    const sameLineAmount = line.match(/^AMOUNT DUE\s*\$?\s*([0-9.,]+)/i);
    if (sameLineAmount && !amount) {
      amount = sameLineAmount[1].replace(/[,\s]/g, "");
    } else if (/^AMOUNT DUE$/i.test(line) && !amount) {
      for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
        const al = lines[j].trim();
        if (al && al.startsWith("$")) {
          amount = al.replace(/[$,\s]/g, "").trim();
          break;
        }
      }
    }

    // --- TOTAL as fallback ---
    const sameLineTotal = line.match(/^TOTAL\s*\$?\s*([0-9.,]+)/i);
    if (sameLineTotal && !total) {
      total = sameLineTotal[1].replace(/[,\s]/g, "");
    } else if (/^TOTAL$/i.test(line) && !total) {
      for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
        const al = lines[j].trim();
        if (al && al.startsWith("$")) {
          total = al.replace(/[$,\s]/g, "").trim();
          break;
        }
      }
    }
  }

  // Prefer AMOUNT DUE; fall back to TOTAL
  const finalAmount = amount || total;

  return { order_number, amount: finalAmount, customer_name, company_name, customer_email };
}

/**
 * Robustly extracts the text string from a Workers AI result.
 */
function extractText(result) {
  if (typeof result === "string") return result;
  if (typeof result?.response === "string") return result.response;
  const choice = result?.choices?.[0];
  if (typeof choice?.message?.content === "string") return choice.message.content;
  if (typeof choice?.text === "string") return choice.text;
  return JSON.stringify(result);
}

/**
 * Parses an AI response string into normalized invoice fields.
 */
function parseAiResponse(aiResponseText) {
  const cleaned = String(aiResponseText)
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/g, "")
    .trim();

  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.error("AI returned no parseable JSON:", aiResponseText);
    return null;
  }

  try {
    return JSON.parse(jsonMatch[0]);
  } catch (e) {
    console.error("JSON.parse failed:", jsonMatch[0], e.message);
    return null;
  }
}

/**
 * Handles invoice analysis using Cloudflare Workers AI.
 * Accepts either raw extracted text (from PDF.js) or raw image bytes.
 * Returns a structured JSON object with extracted invoice fields.
 */
async function handleAnalyzeInvoice(request, env, corsHeaders) {
  const contentType = request.headers.get("Content-Type") || "";

  try {
    if (contentType.includes("application/json")) {
      const body = await request.json();

      // Case A: Text-based (PDF)
      if (body.text) {
        const parsed = parseInvoiceText(body.text);

        // Return immediately if deterministic parse got useful data
        if (parsed.order_number || parsed.customer_name || parsed.amount) {
          return new Response(JSON.stringify(parsed), {
            status: 200,
            headers: { "Content-Type": "application/json", ...corsHeaders },
          });
        }

        // Fallback to text AI
        if (env.AI) {
          try {
            const invoiceText = String(body.text).substring(0, 6000);
            const result = await env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
              messages: [
                {
                  role: "system",
                  content: `Extract invoice fields and return ONLY this JSON (empty string for missing):
{"order_number":"","amount":"","customer_name":"","company_name":"","customer_email":""}
Rules: order_number=digits only, amount=decimal only no $ or commas, no markdown, no explanation.`,
                },
                { role: "user", content: `Invoice:\n\n${invoiceText}` },
              ],
            });
            const extracted = parseAiResponse(extractText(result));
            if (extracted) {
              const normalized = {
                order_number: String(extracted.order_number || "").replace(/\D/g, ""),
                amount:       String(extracted.amount || "").replace(/[^0-9.]/g, ""),
                customer_name: String(extracted.customer_name || "").trim(),
                company_name:  String(extracted.company_name || "").trim(),
                customer_email: String(extracted.customer_email || "").trim(),
              };
              return new Response(JSON.stringify(normalized), {
                status: 200,
                headers: { "Content-Type": "application/json", ...corsHeaders },
              });
            }
          } catch (err) {
            console.error("Worker: AI text fallback error:", err.message);
          }
        }

        // Return deterministic result (even if partial)
        return new Response(JSON.stringify(parsed), {
          status: 200,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      }

      // Case B: JSON contains image base64
      if (body.imageBase64) {
        if (!env.AI) {
          return new Response(
            JSON.stringify({ message: "Workers AI binding (AI) is not configured." }),
            { status: 503, headers: { "Content-Type": "application/json", ...corsHeaders } }
          );
        }

        const result = await env.AI.run("@cf/meta/llama-4-scout-17b-16e-instruct", {
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: `Extract invoice fields from this image and return ONLY this JSON (empty string for missing fields):
{"order_number":"","amount":"","customer_name":"","company_name":"","customer_email":""}
Rules: order_number=digits only, amount=decimal only no $ or commas (e.g. "252.20"), no markdown, no explanation.`,
                },
                {
                  type: "image_url",
                  image_url: { url: `data:image/jpeg;base64,${body.imageBase64}` },
                },
              ],
            },
          ],
        });

        const extracted = parseAiResponse(extractText(result));
        if (extracted) {
          const normalized = {
            order_number: String(extracted.order_number || "").replace(/\D/g, ""),
            amount:       String(extracted.amount || "").replace(/[^0-9.]/g, ""),
            customer_name: String(extracted.customer_name || "").trim(),
            company_name:  String(extracted.company_name || "").trim(),
            customer_email: String(extracted.customer_email || "").trim(),
          };
          return new Response(JSON.stringify(normalized), {
            status: 200,
            headers: { "Content-Type": "application/json", ...corsHeaders },
          });
        }

        return new Response(
          JSON.stringify({ message: "AI could not extract data from image", raw: String(extractText(result)).substring(0, 500) }),
          { status: 422, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }
    } else {
      // Raw image bytes upload (non-JSON)
      const imageBuffer = await request.arrayBuffer();
      if (!imageBuffer.byteLength) {
        return new Response(JSON.stringify({ message: "No image data provided" }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      }

      if (!env.AI) {
        return new Response(
          JSON.stringify({ message: "Workers AI binding (AI) is not configured." }),
          { status: 503, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }

      const imageBase64 = arrayBufferToBase64(imageBuffer);
      const result = await env.AI.run("@cf/meta/llama-4-scout-17b-16e-instruct", {
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Extract invoice fields from this image and return ONLY this JSON (empty string for missing fields):
{"order_number":"","amount":"","customer_name":"","company_name":"","customer_email":""}
Rules: order_number=digits only, amount=decimal only no $ or commas (e.g. "252.20"), no markdown, no explanation.`,
              },
              {
                type: "image_url",
                image_url: { url: `data:image/jpeg;base64,${imageBase64}` },
              },
            ],
          },
        ],
      });

      const extracted = parseAiResponse(extractText(result));
      if (extracted) {
        const normalized = {
          order_number: String(extracted.order_number || "").replace(/\D/g, ""),
          amount:       String(extracted.amount || "").replace(/[^0-9.]/g, ""),
          customer_name: String(extracted.customer_name || "").trim(),
          company_name:  String(extracted.company_name || "").trim(),
          customer_email: String(extracted.customer_email || "").trim(),
        };
        return new Response(JSON.stringify(normalized), {
          status: 200,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      }

      return new Response(
        JSON.stringify({ message: "AI could not extract data from image", raw: String(extractText(result)).substring(0, 500) }),
        { status: 422, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    return new Response(
      JSON.stringify({ message: "Invalid request format" }),
      { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (err) {
    console.error("Invoice analysis error:", err);
    return new Response(
      JSON.stringify({ message: "Invoice analysis failed", error: err.message }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
}
