// Cloudflare Pages Function: POST /analyze-invoice
// For PDF text: uses deterministic regex parsing (fast, reliable, no AI needed).
// For images: uses Workers AI llama-4-scout vision model.
// Requires AI binding for image path: Pages -> Settings -> Functions -> Workers AI Bindings (Variable: AI)

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, X-Staff-Passcode",
  "Content-Type": "application/json",
};

/**
 * Deterministic parser for Overnight Printing Seattle invoice text (extracted from PDF).
 * The PDF text layout is consistent:
 *   Line "No:"  → next non-empty line = invoice number
 *   Line "Ship To:" → next lines: customer name, company name, "E-Mail: ..."
 *   Line "AMOUNT DUE" → next non-empty line starting with "$" = amount
 */
function parseInvoiceText(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim());

  let order_number = "";
  let customer_name = "";
  let company_name = "";
  let customer_email = "";
  let amount = "";

  let inDescription = false;
  let descLines = [];

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

    // --- Amount Due ---
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

    // --- Description / Job Details ---
    if (/Description/i.test(line) && !inDescription) {
      inDescription = true;
      continue;
    }

    if (inDescription) {
      if (/^(Customer Discount|SUBTOTAL|TAX|SHIPPING|TOTAL|AMOUNT DUE|Received by|Account Type:)/i.test(line)) {
        inDescription = false;
      } else {
        const trimmed = line.trim();
        if (trimmed) {
          descLines.push(trimmed);
        }
      }
    }
  }

  // Clean up description lines
  const cleanedDesc = descLines.map(l => {
    let clean = l;
    
    // Match: [quantity] [description] [price] (e.g. "1,000   4 x 9 Stacy...   $ 266.62")
    const fullMatch = clean.match(/^([0-9,]+)\s+(.*?)\s+(\$?\s*-?[0-9,]+\.[0-9]{2})$/);
    if (fullMatch) {
      clean = fullMatch[2];
    } else {
      // Match: [quantity] [description] (e.g. "10   Cut to 4 x 9")
      const qtyMatch = clean.match(/^([0-9,]+)\s+(.*)$/);
      if (qtyMatch && parseInt(qtyMatch[1].replace(/,/g, "")) < 100000) {
        if (!/^x\s/i.test(qtyMatch[2])) {
          clean = qtyMatch[2];
        }
      }
    }

    // Strip "Taken by" or "SUBTOTAL" garbage that gets merged onto the same line
    clean = clean.replace(/\s*Taken by:\s*.*$/i, "");
    clean = clean.replace(/\s*SUBTOTAL\s*.*$/i, "");
    return clean.trim();
  }).filter(l => l && !/^(Quantity|Description|Amount|Taken by:)$/i.test(l));

  const job_description = cleanedDesc.join(", ");

  return { order_number, amount, customer_name, company_name, customer_email, job_description };
}

/**
 * Robustly extracts the text string from a Workers AI result (handles all response shapes).
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

  // Greedy match: first { to last } to capture the complete JSON object
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

export async function onRequestPost(context) {
  const { request, env } = context;

  // Enforce passcode check if STAFF_PASSCODE is set in the environment
  const passcode = request.headers.get("X-Staff-Passcode");
  if (env.STAFF_PASSCODE && passcode !== env.STAFF_PASSCODE) {
    return new Response(JSON.stringify({ message: "Unauthorized: Invalid or missing staff passcode" }), {
      status: 401,
      headers: CORS_HEADERS,
    });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ message: "Invalid JSON body" }), { status: 400, headers: CORS_HEADERS });
  }

  // ── PDF TEXT path: deterministic parsing, no AI needed ────────────────────
  if (body.text) {
    const parsed = parseInvoiceText(body.text);

    // If deterministic parser got at least something useful, return it directly
    if (parsed.order_number || parsed.customer_name || parsed.amount) {
      return new Response(JSON.stringify(parsed), { status: 200, headers: CORS_HEADERS });
    }

    // Fallback: if the PDF layout was unusual, let AI try
    if (env.AI) {
      try {
        const invoiceText = String(body.text).substring(0, 6000);
        const result = await env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
          messages: [
            {
              role: "system",
              content: `Extract invoice fields and return ONLY this JSON (empty string for missing):
{"order_number":"","amount":"","customer_name":"","company_name":"","customer_email":"","job_description":""}
Rules: order_number=digits only, amount=decimal only no $ or commas, no markdown, no explanation. Summarize the items or services printed under job_description.`,
            },
            { role: "user", content: `Invoice:\n\n${invoiceText}` },
          ],
        });
        const extracted = parseAiResponse(extractText(result));
        if (extracted) {
          return new Response(JSON.stringify({
            order_number: String(extracted.order_number || "").replace(/\D/g, ""),
            amount:       String(extracted.amount || "").replace(/[^0-9.]/g, ""),
            customer_name: String(extracted.customer_name || "").trim(),
            company_name:  String(extracted.company_name || "").trim(),
            customer_email: String(extracted.customer_email || "").trim(),
            job_description: String(extracted.job_description || "").trim(),
          }), { status: 200, headers: CORS_HEADERS });
        }
      } catch (err) {
        console.error("AI text fallback error:", err.message);
      }
    }

    // Return whatever the deterministic parser got (even if partial)
    return new Response(JSON.stringify(parsed), { status: 200, headers: CORS_HEADERS });
  }

  // ── IMAGE path: use Workers AI vision model ───────────────────────────────
  if (body.imageBase64) {
    if (!env.AI) {
      return new Response(
        JSON.stringify({ message: "Workers AI binding (AI) is not configured for image analysis." }),
        { status: 503, headers: CORS_HEADERS }
      );
    }

    try {
      const result = await env.AI.run("@cf/meta/llama-4-scout-17b-16e-instruct", {
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Extract invoice fields from this image and return ONLY this JSON (empty string for missing fields):
{"order_number":"","amount":"","customer_name":"","company_name":"","customer_email":"","job_description":""}
Rules: order_number=digits only, amount=decimal only no $ or commas (e.g. "252.20"), no markdown, no explanation. Summarize the items or services printed under job_description.`,
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
        return new Response(JSON.stringify({
          order_number: String(extracted.order_number || "").replace(/\D/g, ""),
          amount:       String(extracted.amount || "").replace(/[^0-9.]/g, ""),
          customer_name: String(extracted.customer_name || "").trim(),
          company_name:  String(extracted.company_name || "").trim(),
          customer_email: String(extracted.customer_email || "").trim(),
          job_description: String(extracted.job_description || "").trim(),
        }), { status: 200, headers: CORS_HEADERS });
      }

      return new Response(
        JSON.stringify({ message: "AI could not extract data from image", raw: String(extractText(result)).substring(0, 500) }),
        { status: 422, headers: CORS_HEADERS }
      );
    } catch (err) {
      console.error("Vision model error:", err.name, err.message);
      return new Response(
        JSON.stringify({ message: "Image analysis failed", error: `${err.name}: ${err.message}` }),
        { status: 500, headers: CORS_HEADERS }
      );
    }
  }

  return new Response(
    JSON.stringify({ message: "Body must include 'imageBase64' or 'text'" }),
    { status: 400, headers: CORS_HEADERS }
  );
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Staff-Passcode",
    },
  });
}
