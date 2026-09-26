const TARGET = "https://dabgchjcbxgtnntamerx.supabase.co/functions/v1/vinht-moncash-create-payment";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const authorization = String(req.headers.authorization || "");
  if (!authorization.toLowerCase().startsWith("bearer ")) {
    return res.status(401).json({ error: "not_authenticated" });
  }

  // Défense en profondeur : le proxy ne transmet JAMAIS le corps brut. Il ne
  // reconstruit que le seul champ attendu par le backend (order_id) — même si
  // le frontend venait un jour à envoyer autre chose (montant, etc.), ce
  // proxy ne le laisserait pas passer. Le backend reste de toute façon seul
  // autoritaire (il relit orders.total_htg lui-même), ceci est une couche
  // supplémentaire, pas la seule protection.
  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const orderId = body && typeof body.order_id !== "undefined" ? body.order_id : null;
  const payload = JSON.stringify({ order_id: orderId });

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
    console.error("[VINHT] moncash create-payment proxy:", error);
    return res.status(502).json({ error: "payment_backend_unreachable" });
  }
}
