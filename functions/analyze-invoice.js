// Cloudflare Pages Function: POST /analyze-invoice
// Uses Cloudflare Workers AI to extract structured invoice data from text or image.
// Requires the AI binding to be configured in the Cloudflare Pages project settings:
//   Dashboard -> Pages -> {project} -> Settings -> Functions -> AI Bindings -> Add binding (Variable: AI)

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

// Prompt tuned specifically for Overnight Printing Seattle invoice format:
//   - "No:" field = Invoice number
//   - "Ship To:" section = customer name (first line), company name (second line), E-Mail:
//   - "AMOUNT DUE" row = final amount to charge
const SYSTEM_PROMPT = `You are a precise invoice data extraction assistant for Overnight Printing Seattle.
Extract the following fields from the provided invoice. The invoices have this structure:
- Top right: "No:" followed by the invoice number (e.g. "No: 56631")
- "Ship To:" section contains: first line = customer full name, second line = company name, "E-Mail:" = email address
- Bottom right summary table: look for "AMOUNT DUE" row for the total amount to charge

Extract these fields:
- order_number: The invoice number after "No:" (string, digits only, no # prefix)
- amount: The value on the "AMOUNT DUE" row (decimal string, digits and dot only, no $ or commas)
- customer_name: The customer's full name from the "Ship To:" section (first line after "Ship To:")
- company_name: The company name from the "Ship To:" section (second line, if present)
- customer_email: The email address from the "E-Mail:" field in "Ship To:"

Respond ONLY with a valid JSON object, no explanation, no markdown:
{"order_number":"","amount":"","customer_name":"","company_name":"","customer_email":""}`;

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.AI) {
    return new Response(
      JSON.stringify({ message: "Workers AI binding (AI) is not configured. Add it in Cloudflare Pages settings." }),
      { status: 503, headers: CORS_HEADERS }
    );
  }

  let aiResponse = "";

  try {
    const body = await request.json();

    let result;

    if (body.imageBase64) {
      // Image invoice: convert base64 back to byte array for the vision model
      const binaryStr = atob(body.imageBase64);
      const imageBytes = new Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        imageBytes[i] = binaryStr.charCodeAt(i);
      }

      result = await env.AI.run("@cf/meta/llama-3.2-11b-vision-instruct", {
        prompt: `${SYSTEM_PROMPT}\n\nExtract the invoice data from this invoice image.`,
        image: imageBytes,
      });
    } else if (body.text) {
      // Text PDF invoice: use the text LLM
      const invoiceText = String(body.text).substring(0, 8000);

      result = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `Extract the invoice data from the following invoice text:\n\n${invoiceText}` },
        ],
      });
    } else {
      return new Response(
        JSON.stringify({ message: "Request body must include either 'text' or 'imageBase64'" }),
        { status: 400, headers: CORS_HEADERS }
      );
    }

    aiResponse = result.response || "";

    // Strip markdown fences in case the model added them
    const cleaned = aiResponse
      .replace(/```json\s*/gi, "")
      .replace(/```\s*/g, "")
      .trim();

    // Find the first JSON object in the response
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error("AI returned no parseable JSON:", aiResponse);
      return new Response(
        JSON.stringify({ message: "AI could not parse the invoice", raw: aiResponse }),
        { status: 422, headers: CORS_HEADERS }
      );
    }

    const extracted = JSON.parse(jsonMatch[0]);

    const normalized = {
      order_number: String(extracted.order_number || "").trim(),
      // Strip everything except digits and decimal point from the amount
      amount: String(extracted.amount || "").replace(/[^0-9.]/g, "").trim(),
      customer_name: String(extracted.customer_name || "").trim(),
      company_name: String(extracted.company_name || "").trim(),
      customer_email: String(extracted.customer_email || "").trim(),
    };

    return new Response(JSON.stringify(normalized), {
      status: 200,
      headers: CORS_HEADERS,
    });
  } catch (err) {
    console.error("analyze-invoice error:", err);
    return new Response(
      JSON.stringify({ message: "Invoice analysis failed", error: err.message }),
      { status: 500, headers: CORS_HEADERS }
    );
  }
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
