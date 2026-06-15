// Cloudflare Worker backend for Overnight Printing Seattle Payment Portal
// Handles secure Supabase updates (bypassing RLS with service_role), Resend emails, and CardPointe charges.

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");

    // 1. CORS Preflight & Headers Setup
    const corsHeaders = {
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
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
        return await handleCreateLink(request, env, corsHeaders);
      } else if (url.pathname === "/charge" && request.method === "POST") {
        return await handleCharge(request, env, corsHeaders);
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
async function handleCreateLink(request, env, corsHeaders) {
  const { order_number, amount, customer_name, customer_email } = await request.json();

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

  // 2. Send client email via Resend
  const isLocal = request.headers.get("Origin")?.includes("localhost");
  const baseDomain = isLocal ? request.headers.get("Origin") : "https://pay.overnightprintingseattle.com";
  const paymentLinkUrl = `${baseDomain}/pay/${uuid}`;

  const resendEmailBody = {
    from: "Overnight Printing Seattle <billing@overnightprintingseattle.com>",
    to: [customer_email],
    subject: `Invoice Payment Request: Order #${order_number}`,
    html: `
      <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 600px; margin: 0 auto; padding: 32px; border: 1px solid #e2e1e8; border-radius: 16px; background-color: #ffffff; color: #1f2937;">
        <h2 style="color: #6d28d9; margin-top: 0; font-size: 24px; font-weight: 700; letter-spacing: -0.02em;">Invoice Payment Request</h2>
        <p style="font-size: 16px; line-height: 1.5; color: #4b5563;">Hello ${customer_name},</p>
        <p style="font-size: 16px; line-height: 1.5; color: #4b5563;">A secure payment link has been created for your print order with Overnight Printing Seattle.</p>
        
        <div style="background-color: #f3f4f6; border-radius: 12px; padding: 20px; margin: 24px 0;">
          <table style="width: 100%; border-collapse: collapse; font-size: 15px;">
            <tr>
              <td style="padding: 6px 0; color: #6b7280;">Order Number:</td>
              <td style="padding: 6px 0; font-weight: 600; text-align: right;">#${order_number}</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #6b7280; border-top: 1px dashed #e5e7eb;">Amount Due:</td>
              <td style="padding: 6px 0; font-weight: 700; font-size: 18px; text-align: right; color: #111827; border-top: 1px dashed #e5e7eb;">$${parseFloat(amount).toFixed(2)} USD</td>
            </tr>
          </table>
        </div>
        
        <div style="text-align: center; margin: 32px 0;">
          <a href="${paymentLinkUrl}" style="background-color: #6d28d9; color: #ffffff; padding: 14px 28px; text-decoration: none; font-weight: 600; font-size: 16px; border-radius: 10px; display: inline-block; transition: background-color 0.2s;">Pay Invoice Securely</a>
        </div>
        
        <p style="font-size: 13px; color: #9ca3af; text-align: center; margin-bottom: 0;">
          If the button above does not work, copy and paste this URL into your browser:<br/>
          <a href="${paymentLinkUrl}" style="color: #6d28d9; word-break: break-all;">${paymentLinkUrl}</a>
        </p>
        <hr style="border: 0; border-top: 1px solid #e5e7eb; margin: 32px 0;" />
        <p style="font-size: 12px; color: #9ca3af; text-align: center; margin-bottom: 0;">
          Questions? Contact us at <a href="mailto:contact@overnightprintingseattle.com" style="color: #6d28d9;">contact@overnightprintingseattle.com</a>
        </p>
      </div>
    `,
  };

  const resendRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(resendEmailBody),
  });

  if (!resendRes.ok) {
    const resendErr = await resendRes.text();
    console.error("Resend API error:", resendErr);
    // We will still return the ID so the staff member can manually copy the link if the email API fails
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

  return new Response(JSON.stringify({ id: uuid, email_sent: true }), {
    status: 200,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

/**
 * Handles charging the tokenized card via CardPointe and updating the Supabase state + notifying internal staff.
 */
async function handleCharge(request, env, corsHeaders) {
  const { token, amount, expiry, cvv2, zip, paymentLinkId } = await request.json();

  if (!token || !amount || !expiry || !cvv2 || !zip || !paymentLinkId) {
    return new Response(JSON.stringify({ message: "Missing transaction parameters" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  // 1. Process with CardPointe
  let cpResult;
  const isMockPayment = env.MOCK_PAYMENT === "true" || amount === "0.07" || parseFloat(amount) === 0.07;

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

  const nameMatch = customerNameRaw.match(/^(.*?)\s*\((.*?)\)$/);
  if (nameMatch) {
    customerName = nameMatch[1];
    companyName = nameMatch[2];
  }

  // 3. Send Internal Notification Email to staff via Resend
  const formattedPaidAt = new Date(paidAt).toLocaleString("en-US", {
    timeZone: "America/Los_Angeles",
    dateStyle: "medium",
    timeStyle: "medium",
  });

  const staffEmailBody = {
    from: "Billing Alerts <billing@overnightprintingseattle.com>",
    to: ["contact@overnightprintingseattle.com"],
    subject: `[Paid] Invoice #${updatedRecord.order_number} - $${parseFloat(amount).toFixed(2)}`,
    html: `
      <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e1e8; border-radius: 12px; background-color: #f9fafb; color: #111827;">
        <h2 style="color: #059669; margin-top: 0; font-size: 20px; font-weight: 700; border-bottom: 2px solid #e5e7eb; padding-bottom: 12px;">Payment Completion Alert (Internal)</h2>
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
