const TARGET = "https://dabgchjcbxgtnntamerx.supabase.co/functions/v1/vinht-flexicash-webhook";

export const config = {
  api: {
    bodyParser: false,
  },
};

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  let rawBody;
  try {
    rawBody = await readRawBody(req);
  } catch (error) {
    console.error("[VINHT] webhook raw body:", error);
    return res.status(400).json({ error: "invalid_body" });
  }

  const headers = {
    "Content-Type": String(req.headers["content-type"] || "application/json"),
    "FlexiCash-Event-Id": String(req.headers["flexicash-event-id"] || ""),
    "FlexiCash-Timestamp": String(req.headers["flexicash-timestamp"] || ""),
    "FlexiCash-Signature": String(req.headers["flexicash-signature"] || ""),
    "FlexiCash-Environment": String(req.headers["flexicash-environment"] || ""),
    "FlexiCash-Delivery-Id": String(req.headers["flexicash-delivery-id"] || ""),
  };

  try {
    const upstream = await fetch(TARGET, {
      method: "POST",
      headers,
      body: rawBody,
    });

    const text = await upstream.text();
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", upstream.headers.get("content-type") || "application/json; charset=utf-8");
    return res.status(upstream.status).send(text);
  } catch (error) {
    console.error("[VINHT] webhook proxy:", error);
    return res.status(502).json({ error: "webhook_backend_unreachable" });
  }
}
