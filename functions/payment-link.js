export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const id = url.searchParams.get("id");

  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };

  if (!id) {
    return new Response(JSON.stringify({ message: "Missing id parameter" }), {
      status: 400,
      headers: corsHeaders,
    });
  }

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
    return new Response(JSON.stringify({ message: "Failed to retrieve invoice from database", details: errText }), {
      status: 502,
      headers: corsHeaders,
    });
  }

  const records = await supabaseRes.json();
  if (!records || records.length === 0) {
    return new Response(JSON.stringify({ message: "Payment link not found or has expired." }), {
      status: 404,
      headers: corsHeaders,
    });
  }

  return new Response(JSON.stringify(records[0]), {
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
