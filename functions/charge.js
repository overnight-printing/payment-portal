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

export async function onRequestPost(context) {
  const { request, env } = context;

  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };

  // 1. Validate environment variables are successfully injected
  const user = env.CARDPOINTE_USER;
  const pass = env.CARDPOINTE_PASS;
  const mid = env.CARDPOINTE_MID;

  if (!user || !pass || !mid) {
    console.error("Pages Functions - CardPointe Credentials missing from env context!", {
      user: !!user,
      pass: !!pass,
      mid: !!mid
    });
    return new Response(
      JSON.stringify({ 
        message: "Server Configuration Error: CardPointe credentials are empty or not injected. Please ensure you saved them in Cloudflare Pages Environment Variables and triggered a fresh build." 
      }), 
      {
        status: 500,
        headers: corsHeaders,
      }
    );
  }

  const { token, amount, expiry, cvv2, zip, paymentLinkId } = await request.json();

  if (!token || !amount || !expiry || !cvv2 || !zip || !paymentLinkId) {
    return new Response(JSON.stringify({ message: "Missing transaction parameters" }), {
      status: 400,
      headers: corsHeaders,
    });
  }

  // 1.5 Verify invoice amount and status against Database securely
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
      headers: corsHeaders,
    });
  }

  const verifyRecords = await verifyRes.json();
  if (!verifyRecords || verifyRecords.length === 0) {
    return new Response(JSON.stringify({ message: "Invoice not found or expired." }), {
      status: 404,
      headers: corsHeaders,
    });
  }

  const invoice = verifyRecords[0];

  // Prevent double charging
  if (invoice.status === "paid") {
    return new Response(JSON.stringify({ message: "This invoice has already been paid." }), {
      status: 400,
      headers: corsHeaders,
    });
  }

  // Prevent amount tampering
  const dbAmount = parseFloat(invoice.amount);
  const reqAmount = parseFloat(amount);
  if (Math.abs(dbAmount - reqAmount) > 0.01) {
    console.error(`Pages Functions - Amount mismatch! DB: ${dbAmount}, Request: ${reqAmount}`);
    return new Response(JSON.stringify({ message: "Payment amount mismatch detected. Please refresh the page and try again." }), {
      status: 400,
      headers: corsHeaders,
    });
  }

  // 2. Process with CardPointe
  let cpResult;
  // Security Fix: Removed the hardcoded 0.07 backdoor. Only allow mock if explicitly enabled in ENV.
  const isMockPayment = env.MOCK_PAYMENT === "true";

  if (isMockPayment) {
    console.log("Pages Functions - Mock payment mode triggered. Bypassing CardPointe Gateway.");
    cpResult = {
      respstat: "A",
      retref: "MOCK-" + Math.floor(Math.random() * 899999 + 100000),
      resptext: "Approval",
      respcode: "00",
    };
  } else {
    const auth = btoa(`${user}:${pass}`);
    const cardpointeBody = {
      merchid: mid,
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
      return new Response(JSON.stringify({ message: "Credit card gateway connection failed" }), {
        status: 502,
        headers: corsHeaders,
      });
    }

    cpResult = await cpRes.json();
  }

  if (cpResult.respstat !== "A") {
    const declineMsg = cpResult.resptext || "Card declined.";
    return new Response(JSON.stringify({ message: declineMsg }), {
      status: 402,
      headers: corsHeaders,
    });
  }

  const retref = cpResult.retref;
  const paidAt = new Date().toISOString();

  // 3. Update Supabase link state using service_role key
  const supabaseRes = await fetch(`${env.SUPABASE_URL}/rest/v1/payment_links?id=eq.${paymentLinkId}`, {
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
  });

  if (!supabaseRes.ok) {
    return new Response(JSON.stringify({ message: "Authorized but DB update failed", retref }), {
      status: 500,
      headers: corsHeaders,
    });
  }

  const records = await supabaseRes.json();
  const updatedRecord = records[0];

  // Parse customer name, company name, and job description
  const customerNameRaw = updatedRecord.customer_name || '';
  let customerName = customerNameRaw;
  let companyName = '';

  const nameMatch = customerNameRaw.match(/^(.*?)(?:\s*\((.*?)\))?(?:\s*\[Job:[^\]]*\])?$/);
  if (nameMatch) {
    customerName = nameMatch[1] ? nameMatch[1].trim() : '';
    companyName = nameMatch[2] ? nameMatch[2].trim() : '';
  }

  // 4. Dispatch internal alert email asynchronously to overnight printing seattle staff
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
            <td style="padding: 8px 0;"><a href="mailto:${updatedRecord.customer_email}">${updatedRecord.customer_email}</a></td>
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

  // Perform Resend request in the background
  context.waitUntil(
    fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(staffEmailBody),
    }).catch(err => {
      console.error("Resend async error:", err);
    })
  );

  return new Response(JSON.stringify({ success: true, retref }), {
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
      "Access-Control-Allow-Headers": "Content-Type",
    }
  });
}
