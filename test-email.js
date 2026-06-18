const resendApiKey = 're_A3n57DFk_CxvGscW3REP5xQXU4F1uN1ST'; // from worker/.dev.vars

const emailBody = {
  from: "Billing Alerts <accounting@overnightprintingseattle.com>",
  to: ["contact@overnightprintingseattle.com", "accounting@overnightprintingseattle.com"],
  subject: "[Paid] Invoice #TEST - $52.57",
  html: `
    <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e1e8; border-radius: 12px; background-color: #f9fafb; color: #111827;">
      <div style="text-align: center; margin-bottom: 24px;">
        <img src="https://pay.overnightprintingseattle.com/logo.png" alt="Overnight Printing Seattle" style="max-height: 60px; width: auto;" />
      </div>
      <h2 style="color: #059669; margin-top: 0; font-size: 20px; font-weight: 700; border-bottom: 2px solid #e5e7eb; padding-bottom: 12px;">Payment Completion Alert</h2>
      <table style="width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 15px;">
        <tr>
          <td style="padding: 8px 0; color: #4b5563; font-weight: 500;">Invoice Number:</td>
          <td style="padding: 8px 0; font-weight: 600;">#TEST</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #4b5563; font-weight: 500;">Amount Paid:</td>
          <td style="padding: 8px 0; font-weight: 700; color: #059669; font-size: 16px;">$52.57 USD</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #4b5563; font-weight: 500;">Payment Method:</td>
          <td style="padding: 8px 0; font-weight: 600;">Visa ending in 4242</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #4b5563; font-weight: 500;">Customer Name:</td>
          <td style="padding: 8px 0;">Test User</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #4b5563; font-weight: 500;">Company Name:</td>
          <td style="padding: 8px 0; font-weight: 600;">Test Company</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #4b5563; font-weight: 500;">Customer Email:</td>
          <td style="padding: 8px 0;"><a href="mailto:test@example.com">test@example.com</a></td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #4b5563; font-weight: 500;">Payment Date:</td>
          <td style="padding: 8px 0;">Jun 16, 2026, 3:00:00 PM (PST)</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #4b5563; font-weight: 500; border-top: 1px dashed #d1d5db;">CardPointe Reference Number:</td>
          <td style="padding: 8px 0; font-weight: 600; font-family: monospace; border-top: 1px dashed #d1d5db;">1234567890</td>
        </tr>
      </table>
    </div>
  `
};

fetch("https://api.resend.com/emails", {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${resendApiKey}`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify(emailBody)
}).then(async res => {
  if (!res.ok) {
    console.error("Failed:", await res.text());
  } else {
    console.log("Success:", await res.json());
  }
});
