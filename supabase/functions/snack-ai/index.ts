// Proxies the frontend's AI calls (idea generation, recipe import by URL or
// photo, ingredient sorting) to the Anthropic API, keeping the real API key server-side
// as a Supabase secret instead of shipping it in browser code.
//
// Deploy:   supabase functions deploy snack-ai
// Secret:   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
// Optional: supabase secrets set ALLOWED_ORIGIN=https://your-frontend.vercel.app

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") || "*";

// Photos arrive already shrunk and JPEG-encoded by the frontend.
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_IMAGES = 4;

const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Only signed-in users may spend Anthropic credit. The anon key alone fails
  // this check because it carries no user.
  const userRes = await fetch(`${Deno.env.get("SUPABASE_URL")}/auth/v1/user`, {
    headers: {
      Authorization: req.headers.get("Authorization") ?? "",
      apikey: Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    },
  });
  if (!userRes.ok) {
    return new Response(JSON.stringify({ error: "Not signed in" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!ANTHROPIC_API_KEY) {
    return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY is not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let payload;
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { prompt, search, images } = payload || {};
  if (typeof prompt !== "string" || !prompt.trim()) {
    return new Response(JSON.stringify({ error: "Missing prompt" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const imageList = images ?? [];
  const imagesOk = Array.isArray(imageList) && imageList.length <= MAX_IMAGES &&
    imageList.every((i) => i && IMAGE_TYPES.includes(i.media_type) && typeof i.data === "string" && i.data);
  if (!imagesOk) {
    return new Response(JSON.stringify({ error: `Send up to ${MAX_IMAGES} JPEG, PNG, WebP or GIF images` }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // With photos, the message is the images followed by the prompt text.
  const content = imageList.length
    ? [
      ...imageList.map((i) => ({ type: "image", source: { type: "base64", media_type: i.media_type, data: i.data } })),
      { type: "text", text: prompt },
    ]
    : prompt;

  const body = {
    model: "claude-sonnet-4-6",
    max_tokens: 2500,
    messages: [{ role: "user", content }],
  };
  if (search) body.tools = [{ type: "web_search_20250305", name: "web_search" }];

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  return new Response(JSON.stringify(data), {
    status: res.status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
