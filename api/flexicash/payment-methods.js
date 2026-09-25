const TARGET = "https://dabgchjcbxgtnntamerx.supabase.co/functions/v1/vinht-flexicash-payment-methods";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const authorization = String(req.headers.authorization || "");
  if (!authorization.toLowerCase().startsWith("bearer ")) {
    return res.status(401).json({ error: "not_authenticated" });
  }

  const payload = typeof req.body === "string" ? req.body : JSON.stringify(req.body || {});

  try {
    const upstream = await fetch(TARGET, {
      method: "POST",
      headers: {
        Authorization: authorization,
        "Content-Type": "application/json",
      },
      body: payload,
    });

    const text = await upstream.text();
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", upstream.headers.get("content-type") || "application/json; charset=utf-8");
    return res.status(upstream.status).send(text);
  } catch (error) {
    console.error("[VINHT] payment-methods proxy:", error);
    return res.status(502).json({ error: "payment_methods_backend_unreachable" });
  }
}
