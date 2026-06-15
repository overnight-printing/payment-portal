// Cloudflare Pages Function: POST /analyze-invoice
// Uses Cloudflare Workers AI to extract structured invoice data from text or image.
// Requires the AI binding configured in Cloudflare Pages project:
//   Dashboard -> Pages -> {project} -> Settings -> Functions -> Workers AI Bindings (Variable: AI)

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

// Prompt tuned specifically for Overnight Printing Seattle invoice format:
//   - "No:" field = Invoice number (top right)
//   - "Ship To:" section = customer name (first line), company name (second line), E-Mail:
//   - "AMOUNT DUE" row = total amount to charge (bottom right table)
const EXTRACTION_PROMPT = `You are an invoice data extraction tool for Overnight Printing Seattle.
The invoices have this structure:
- Top right area: "No:" followed by the invoice number (e.g. "56631")
- "Ship To:" section: first line = customer full name, second line = company name, "E-Mail:" = customer email
- Bottom right summary table: "AMOUNT DUE" row = the final total dollar amount

Extract and return ONLY a single JSON object with exactly these keys (use empty string for missing fields):
{"order_number":"","amount":"","customer_name":"","company_name":"","customer_email":""}

Rules:
- order_number: digits only, no # or spaces
- amount: decimal number only (e.g. "252.20"), no $ or commas
- customer_name: full name as written
- company_name: company/business name, empty string if none
- customer_email: email address, empty string if not found
Output ONLY the JSON object. No explanation. No markdown.`;

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.AI) {
    return new Response(
      JSON.stringify({ message: "Workers AI binding (AI) is not configured. Add it in Cloudflare Pages settings." }),
      { status: 503, headers: CORS_HEADERS }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return new Response(
      JSON.stringify({ message: "Invalid JSON body", error: e.message }),
      { status: 400, headers: CORS_HEADERS }
    );
  }

  // ── Image path ─────────────────────────────────────────────────────────────
  if (body.imageBase64) {
    try {
      // Decode base64 → Uint8Array (proper typed array for Workers AI)
      const binaryStr = atob(body.imageBase64);
      const imageBytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        imageBytes[i] = binaryStr.charCodeAt(i);
      }

      const result = await env.AI.run("@cf/meta/llama-3.2-11b-vision-instruct", {
        prompt: EXTRACTION_PROMPT,
        image: [...imageBytes], // Workers AI expects a plain number array
      });

      return parseAndReturn(result.response || "");
    } catch (err) {
      console.error("Vision model error:", err.name, err.message);
      return new Response(
        JSON.stringify({ message: "Image analysis failed", error: `${err.name}: ${err.message}` }),
        { status: 500, headers: CORS_HEADERS }
      );
    }
  }

  // ── Text (PDF) path ─────────────────────────────────────────────────────────
  if (body.text) {
    try {
      const invoiceText = String(body.text).substring(0, 6000);

      const result = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
        messages: [
          { role: "system", content: EXTRACTION_PROMPT },
          { role: "user", content: `Invoice text to extract from:\n\n${invoiceText}` },
        ],
      });

      return parseAndReturn(result.response || "");
    } catch (err) {
      console.error("Text model error:", err.name, err.message);
      return new Response(
        JSON.stringify({ message: "Text analysis failed", error: `${err.name}: ${err.message}` }),
        { status: 500, headers: CORS_HEADERS }
      );
    }
  }

  return new Response(
    JSON.stringify({ message: "Body must include 'imageBase64' or 'text'" }),
    { status: 400, headers: CORS_HEADERS }
  );
}

/**
 * Parses the AI model response string into a normalized invoice JSON response.
 */
function parseAndReturn(aiResponse) {
  // Strip markdown fences
  const cleaned = aiResponse
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/g, "")
    .trim();

  const jsonMatch = cleaned.match(/\{[\s\S]*?\}/);
  if (!jsonMatch) {
    console.error("AI returned no parseable JSON. Raw response:", aiResponse);
    return new Response(
      JSON.stringify({ message: "AI could not extract structured data from invoice", raw: aiResponse }),
      { status: 422, headers: CORS_HEADERS }
    );
  }

  let extracted;
  try {
    extracted = JSON.parse(jsonMatch[0]);
  } catch (parseErr) {
    return new Response(
      JSON.stringify({ message: "Failed to parse AI JSON output", raw: jsonMatch[0] }),
      { status: 422, headers: CORS_HEADERS }
    );
  }

  const normalized = {
    order_number: String(extracted.order_number || "").replace(/\D/g, "").trim(),
    amount: String(extracted.amount || "").replace(/[^0-9.]/g, "").trim(),
    customer_name: String(extracted.customer_name || "").trim(),
    company_name: String(extracted.company_name || "").trim(),
    customer_email: String(extracted.customer_email || "").trim(),
  };

  return new Response(JSON.stringify(normalized), {
    status: 200,
    headers: CORS_HEADERS,
  });
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
