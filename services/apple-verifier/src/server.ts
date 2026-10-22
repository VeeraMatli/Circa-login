import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { configuration, verifyPurchase } from "./verification.js";
const token = process.env.VERIFIER_AUTH_TOKEN;
if (!token || token.length < 32)
  throw new Error(
    "Set VERIFIER_AUTH_TOKEN to a random credential of at least 32 characters.",
  );
const config = configuration(process.env);
const schema = z
  .object({
    signed_payload: z.string().min(20).max(20000),
    bundle_id: z.string(),
  })
  .strict();
createServer(async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  const provided = Buffer.from(req.headers.authorization ?? ""),
    expected = Buffer.from("Bearer " + token);
  if (
    provided.length !== expected.length ||
    !timingSafeEqual(provided, expected)
  ) {
    res.writeHead(401).end('{"error":"unauthorized"}');
    return;
  }
  if (req.method !== "POST" || req.url !== "/verify") {
    res.writeHead(404).end('{"error":"not_found"}');
    return;
  }
  try {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const raw of req) {
      const chunk = Buffer.from(raw);
      size += chunk.length;
      if (size > 25000) {
        res.writeHead(413).end('{"error":"too_large"}');
        req.destroy();
        return;
      }
      chunks.push(chunk);
    }
    const input = schema.parse(JSON.parse(Buffer.concat(chunks).toString()));
    if (input.bundle_id !== config.bundle) throw new Error("Bundle mismatch");
    const result = await verifyPurchase(input.signed_payload, config);
    res.end(JSON.stringify(result));
  } catch {
    res.writeHead(400).end('{"error":"verification_failed"}');
  }
}).listen(Number(process.env.PORT ?? "8080"), "127.0.0.1");
