import { Hono } from "hono";
import { z } from "zod";
import { APIError, hash, id, now, secret } from "./domain";
import { auth, body, provider, required } from "./http";
import { canSee } from "./profiles";
import type { AppEnv } from "./types";
export const media = new Hono<AppEnv>();
media.use("/me/photos", auth);
media.use("/me/photos/*", auth);
media.use("/photos/*", auth);
export function sanitizeImage(input: Uint8Array): {
  bytes: Uint8Array;
  type: string;
} {
  if (input.length < 32 || input.length > 10 * 1024 * 1024)
    throw new APIError(
      415,
      "INVALID_IMAGE",
      "Image must be JPEG or PNG and under 10 MB.",
    );
  if (
    input[0] === 137 &&
    input[1] === 80 &&
    input[2] === 78 &&
    input[3] === 71
  ) {
    const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
    const width = view.getUint32(16),
      height = view.getUint32(20);
    if (!width || !height || width * height > 25000000)
      throw new APIError(
        415,
        "IMAGE_DIMENSIONS",
        "Image dimensions exceed the limit.",
      );
    const chunks: Uint8Array[] = [input.slice(0, 8)];
    let offset = 8,
      ended = false;
    while (offset + 12 <= input.length) {
      const length = view.getUint32(offset);
      if (offset + length + 12 > input.length)
        throw new APIError(415, "INVALID_IMAGE", "Malformed PNG.");
      const type = new TextDecoder().decode(
        input.slice(offset + 4, offset + 8),
      );
      if (["IHDR", "PLTE", "IDAT", "IEND", "tRNS"].includes(type))
        chunks.push(input.slice(offset, offset + length + 12));
      offset += length + 12;
      if (type === "IEND") {
        ended = true;
        break;
      }
    }
    if (!ended) throw new APIError(415, "INVALID_IMAGE", "Malformed PNG.");
    const output = new Uint8Array(chunks.reduce((s, c) => s + c.length, 0));
    let position = 0;
    for (const c of chunks) {
      output.set(c, position);
      position += c.length;
    }
    return { bytes: output, type: "image/png" };
  }
  if (input[0] === 255 && input[1] === 216) {
    const chunks = [input.slice(0, 2)];
    let offset = 2,
      scan = false;
    while (offset + 4 < input.length) {
      if (input[offset] !== 255)
        throw new APIError(415, "INVALID_IMAGE", "Malformed JPEG.");
      const marker = input[offset + 1]!;
      if (marker === 218) {
        chunks.push(input.slice(offset));
        scan = true;
        break;
      }
      const len = (input[offset + 2]! << 8) | input[offset + 3]!;
      if (len < 2 || offset + 2 + len > input.length)
        throw new APIError(415, "INVALID_IMAGE", "Malformed JPEG.");
      if (!(marker >= 224 && marker <= 239) && marker !== 254)
        chunks.push(input.slice(offset, offset + 2 + len));
      offset += 2 + len;
    }
    if (!scan || input.at(-2) !== 255 || input.at(-1) !== 217)
      throw new APIError(415, "INVALID_IMAGE", "Malformed JPEG.");
    const output = new Uint8Array(chunks.reduce((s, c) => s + c.length, 0));
    let position = 0;
    for (const c of chunks) {
      output.set(c, position);
      position += c.length;
    }
    return { bytes: output, type: "image/jpeg" };
  }
  throw new APIError(
    415,
    "UNSUPPORTED_IMAGE",
    "Use JPEG or PNG. HEIC requires the configured image processor.",
  );
}
media.get("/me/photos", async (c) =>
  c.json({
    data: (
      await c.env.DB.prepare(
        "SELECT id,status,position FROM profile_photos WHERE user_id=? ORDER BY position,id",
      )
        .bind(c.get("userId"))
        .all()
    ).results,
  }),
);
media.post("/me/photos/upload-intent", async (c) => {
  await body(c, z.object({}).strict());
  const photoId = id(),
    token = secret(),
    user = c.get("userId");
  const result = await c.env.DB.prepare(
    `INSERT INTO profile_photos(id,user_id,object_key,position,upload_hash,upload_expires,created_at) SELECT ?,?,?,COALESCE(MAX(position),-1)+1,?,?,? FROM profile_photos WHERE user_id=? HAVING COUNT(*)<9`,
  )
    .bind(
      photoId,
      user,
      `${user}/${photoId}`,
      await hash(token),
      now() + 600,
      now(),
      user,
    )
    .run();
  if (!result.meta.changes)
    throw new APIError(409, "PHOTO_LIMIT", "You can upload up to 9 photos.");
  return c.json(
    {
      data: {
        photo_id: photoId,
        upload_path: `/v1/me/photos/${photoId}/content`,
        upload_token: token,
        expires_in: 600,
        max_bytes: 10485760,
      },
    },
    201,
  );
});
media.put("/me/photos/:photoId/content", async (c) => {
  const row = await c.env.DB.prepare(
    "SELECT object_key,upload_hash,upload_expires FROM profile_photos WHERE id=? AND user_id=?",
  )
    .bind(c.req.param("photoId"), c.get("userId"))
    .first<{
      object_key: string;
      upload_hash: string;
      upload_expires: number;
    }>();
  const token = c.req.header("x-upload-token") ?? "";
  if (
    !row ||
    row.upload_expires < now() ||
    row.upload_hash !== (await hash(token))
  )
    throw new APIError(403, "UPLOAD_EXPIRED", "Create a new upload intent.");
  if (Number(c.req.header("content-length")) > 10485760)
    throw new APIError(413, "IMAGE_TOO_LARGE", "Photo exceeds 10 MB.");
  const reader = c.req.raw.body?.getReader();
  if (!reader) throw new APIError(400, "IMAGE_REQUIRED", "Choose an image.");
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    length += result.value.length;
    if (length > 10485760) {
      await reader.cancel();
      throw new APIError(413, "IMAGE_TOO_LARGE", "Photo exceeds 10 MB.");
    }
    chunks.push(result.value);
  }
  let bytes = new Uint8Array(length),
    offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  if (c.env.LOCAL_MODE !== "true") {
    const res = await provider(
      required(c.env.MEDIA_PROCESSOR_URL, "Image processor"),
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${required(c.env.MEDIA_PROCESSOR_TOKEN, "Image processor token")}`,
          "Content-Type": "application/octet-stream",
        },
        body: bytes,
      },
    );
    bytes = new Uint8Array(await res.arrayBuffer());
  }
  const safe = sanitizeImage(bytes),
    digest = await hash(safe.bytes.buffer as ArrayBuffer);
  const duplicate = await c.env.DB.prepare(
    "SELECT id FROM profile_photos WHERE user_id=? AND content_hash=? AND id<>?",
  )
    .bind(c.get("userId"), digest, c.req.param("photoId"))
    .first();
  if (duplicate)
    throw new APIError(
      409,
      "DUPLICATE_PHOTO",
      "You already uploaded this image.",
    );
  const claim = await c.env.DB.prepare(
    "UPDATE profile_photos SET upload_hash=NULL,upload_expires=NULL WHERE id=? AND user_id=? AND upload_hash=? AND upload_expires>?",
  )
    .bind(c.req.param("photoId"), c.get("userId"), await hash(token), now())
    .run();
  if (!claim.meta.changes)
    throw new APIError(
      403,
      "UPLOAD_EXPIRED",
      "This upload authorization has already been used.",
    );
  await c.env.MEDIA.put(row.object_key, safe.bytes, {
    httpMetadata: { contentType: safe.type },
    customMetadata: { private: "true" },
  });
  try {
    await c.env.DB.prepare(
      "UPDATE profile_photos SET content_hash=? WHERE id=?",
    )
      .bind(digest, c.req.param("photoId"))
      .run();
  } catch (error) {
    await c.env.MEDIA.delete(row.object_key);
    if (String(error).includes("UNIQUE constraint"))
      throw new APIError(
        409,
        "DUPLICATE_PHOTO",
        "You already uploaded this image.",
      );
    throw error;
  }
  return c.json({ data: { uploaded: true } });
});
media.post("/me/photos/complete", async (c) => {
  const d = await body(c, z.object({ photo_id: z.uuid() }).strict());
  const row = await c.env.DB.prepare(
    "SELECT id FROM profile_photos WHERE id=? AND user_id=? AND content_hash IS NOT NULL",
  )
    .bind(d.photo_id, c.get("userId"))
    .first();
  if (!row)
    throw new APIError(404, "PHOTO_NOT_FOUND", "Upload the photo first.");
  await c.env.EVENTS.send({ kind: "moderate_photo", photo_id: d.photo_id });
  return c.json(
    { data: { status: "pending", mock: c.env.LOCAL_MODE === "true" } },
    202,
  );
});
media.patch("/me/photos/order", async (c) => {
  const d = await body(
    c,
    z
      .object({
        photo_ids: z
          .array(z.uuid())
          .max(9)
          .refine((a) => new Set(a).size === a.length),
      })
      .strict(),
  );
  const own = (
    await c.env.DB.prepare("SELECT id FROM profile_photos WHERE user_id=?")
      .bind(c.get("userId"))
      .all<{ id: string }>()
  ).results.map((x) => x.id);
  if (
    own.length !== d.photo_ids.length ||
    d.photo_ids.some((x) => !own.includes(x))
  )
    throw new APIError(
      400,
      "INVALID_PHOTO_ORDER",
      "Include each of your photos exactly once.",
    );
  if (d.photo_ids.length)
    await c.env.DB.batch(
      d.photo_ids.map((photo, i) =>
        c.env.DB.prepare(
          "UPDATE profile_photos SET position=? WHERE id=? AND user_id=?",
        ).bind(i, photo, c.get("userId")),
      ),
    );
  return c.json({ data: { saved: true } });
});
media.delete("/me/photos/:photoId", async (c) => {
  const row = await c.env.DB.prepare(
    "SELECT object_key FROM profile_photos WHERE id=? AND user_id=?",
  )
    .bind(c.req.param("photoId"), c.get("userId"))
    .first<{ object_key: string }>();
  if (!row) throw new APIError(404, "PHOTO_NOT_FOUND", "Photo unavailable.");
  await c.env.MEDIA.delete(row.object_key);
  await c.env.DB.prepare("DELETE FROM profile_photos WHERE id=?")
    .bind(c.req.param("photoId"))
    .run();
  return c.json({ data: { deleted: true } });
});
media.get("/photos/:photoId", async (c) => {
  const row = await c.env.DB.prepare(
    "SELECT user_id,object_key,status FROM profile_photos WHERE id=?",
  )
    .bind(c.req.param("photoId"))
    .first<{ user_id: string; object_key: string; status: string }>();
  if (
    !row ||
    (row.user_id !== c.get("userId") &&
      (row.status !== "approved" || !(await canSee(c, row.user_id))))
  )
    throw new APIError(404, "PHOTO_NOT_FOUND", "Photo unavailable.");
  const obj = await c.env.MEDIA.get(row.object_key);
  if (!obj) throw new APIError(404, "PHOTO_NOT_FOUND", "Photo unavailable.");
  return new Response(obj.body, {
    headers: {
      "Content-Type":
        obj.httpMetadata?.contentType ?? "application/octet-stream",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
