import { Hono } from "hono";
import { z } from "zod";
import { APIError, id, now, sparks } from "./domain";
import { auth, body, limit, page, type C } from "./http";
import { D1Conversations } from "./repositories";
import type { AppEnv, Env, MatchRow } from "./types";
export const messaging = new Hono<AppEnv>();
messaging.use("/matches", auth);
messaging.use("/matches/*", auth);
messaging.use("/conversations", auth);
messaging.use("/conversations/*", auth);
messaging.use("/realtime/*", auth);
async function membership(c: C, conversationId: string) {
  if (
    !(await new D1Conversations(c.env.DB).authorize(
      conversationId,
      c.get("userId"),
    ))
  )
    throw new APIError(
      404,
      "CONVERSATION_NOT_FOUND",
      "Conversation unavailable.",
    );
}
messaging.get("/matches", async (c) => {
  const { limit, cursor } = page(c),
    me = c.get("userId");
  const result = await c.env.DB.prepare(
    `SELECT m.*,p.display_name,p.bio FROM matches m JOIN profiles p ON p.user_id=CASE WHEN m.user_a=? THEN m.user_b ELSE m.user_a END WHERE (m.user_a=? OR m.user_b=?) AND m.status='active' AND m.id>? ORDER BY m.id LIMIT ?`,
  )
    .bind(me, me, me, cursor, limit)
    .all();
  return c.json({
    data: result.results,
    next_cursor:
      result.results.length === limit ? result.results.at(-1)?.id : null,
  });
});
messaging.get("/matches/:matchId", async (c) => {
  await membership(c, c.req.param("matchId"));
  return c.json({
    data: await c.env.DB.prepare("SELECT * FROM matches WHERE id=?")
      .bind(c.req.param("matchId"))
      .first(),
    sparks,
  });
});
messaging.delete("/matches/:matchId", async (c) => {
  const match = c.req.param("matchId");
  await membership(c, match);
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE matches SET status='unmatched' WHERE id=?").bind(
      match,
    ),
    c.env.DB.prepare("INSERT INTO unmatches VALUES(?,?,?,?)").bind(
      id(),
      match,
      c.get("userId"),
      now(),
    ),
  ]);
  await c.env.CHAT.get(c.env.CHAT.idFromName(match)).fetch(
    new Request("https://internal/disconnect", { method: "POST" }),
  );
  return c.json({ data: { unmatched: true } });
});
messaging.get("/conversations", async (c) => {
  const { limit, cursor } = page(c),
    me = c.get("userId");
  const rows = await c.env.DB.prepare(
    `SELECT c.id,c.match_id,p.display_name,(SELECT body FROM messages WHERE conversation_id=c.id ORDER BY sequence DESC LIMIT 1) AS last_message,(SELECT COUNT(*) FROM messages x WHERE x.conversation_id=c.id AND x.sender_id<>? AND NOT EXISTS(SELECT 1 FROM message_receipts r WHERE r.message_id=x.id AND r.user_id=? AND r.read_at IS NOT NULL)) AS unread_count FROM conversations c JOIN matches m ON m.id=c.match_id JOIN profiles p ON p.user_id=CASE WHEN m.user_a=? THEN m.user_b ELSE m.user_a END WHERE (m.user_a=? OR m.user_b=?) AND m.status='active' AND NOT EXISTS(SELECT 1 FROM conversation_settings s WHERE s.conversation_id=c.id AND s.user_id=? AND s.hidden=1) AND c.id>? ORDER BY c.id LIMIT ?`,
  )
    .bind(me, me, me, me, me, me, cursor, limit)
    .all();
  return c.json({
    data: rows.results,
    next_cursor: rows.results.length === limit ? rows.results.at(-1)?.id : null,
  });
});
messaging.get("/conversations/:conversationId/messages", async (c) => {
  const conversation = c.req.param("conversationId");
  await membership(c, conversation);
  const { limit } = page(c),
    after = Math.max(0, Number(c.req.query("after")) || 0);
  const q = (c.req.query("q") ?? "").slice(0, 100);
  const result = await c.env.DB.prepare(
    "SELECT id,sender_id,body,reply_to,created_at,sequence FROM messages WHERE conversation_id=? AND sequence>? AND instr(lower(body),lower(?))>0 ORDER BY sequence LIMIT ?",
  )
    .bind(conversation, after, q, limit)
    .all();
  return c.json({
    data: result.results,
    next_cursor:
      result.results.length === limit ? result.results.at(-1)?.sequence : null,
  });
});
messaging.post("/conversations/:conversationId/messages", async (c) => {
  const conversation = c.req.param("conversationId");
  await membership(c, conversation);
  const d = await body(
    c,
    z
      .object({
        client_id: z.uuid(),
        body: z.string().trim().min(1).max(2000),
        reply_to: z.uuid().nullable().default(null),
      })
      .strict(),
  );
  await limit(c.env, "messages:" + c.get("userId"), 30);
  if (
    d.reply_to &&
    !(await c.env.DB.prepare(
      "SELECT id FROM messages WHERE id=? AND conversation_id=?",
    )
      .bind(d.reply_to, conversation)
      .first())
  )
    throw new APIError(
      400,
      "INVALID_REPLY",
      "Reply must belong to this conversation.",
    );
  const stub = c.env.CHAT.get(c.env.CHAT.idFromName(conversation));
  const res = await stub.fetch(
    new Request("https://internal/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...d,
        conversation_id: conversation,
        user_id: c.get("userId"),
      }),
    }),
  );
  if (!res.ok) {
    const problem = (await res.json()) as {
      error: { code: string; message: string };
    };
    throw new APIError(res.status, problem.error.code, problem.error.message);
  }
  return new Response(res.body, {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  });
});
messaging.post("/conversations/:conversationId/receipts", async (c) => {
  const conversation = c.req.param("conversationId");
  await membership(c, conversation);
  const d = await body(
    c,
    z.object({ message_id: z.uuid(), read: z.boolean() }).strict(),
  );
  await c.env.DB.prepare(
    `INSERT INTO message_receipts(message_id,user_id,delivered_at,read_at) SELECT id,?,?,? FROM messages WHERE id=? AND conversation_id=? ON CONFLICT(message_id,user_id) DO UPDATE SET delivered_at=excluded.delivered_at,read_at=COALESCE(excluded.read_at,read_at)`,
  )
    .bind(
      c.get("userId"),
      now(),
      d.read ? now() : null,
      d.message_id,
      conversation,
    )
    .run();
  return c.json({ data: { saved: true } });
});
messaging.post("/conversations/:conversationId/reactions", async (c) => {
  const conversation = c.req.param("conversationId");
  await membership(c, conversation);
  const d = await body(
    c,
    z
      .object({
        message_id: z.uuid(),
        emoji: z.enum(["❤️", "👍", "😂", "✨", "😊"]),
      })
      .strict(),
  );
  await c.env.DB.prepare(
    "INSERT INTO message_reactions SELECT id,?,? FROM messages WHERE id=? AND conversation_id=? ON CONFLICT(message_id,user_id) DO UPDATE SET emoji=excluded.emoji",
  )
    .bind(c.get("userId"), d.emoji, d.message_id, conversation)
    .run();
  return c.json({ data: { saved: true } });
});
messaging.patch("/conversations/:conversationId/settings", async (c) => {
  const conversation = c.req.param("conversationId");
  await membership(c, conversation);
  const d = await body(
    c,
    z.object({ muted: z.boolean(), hidden: z.boolean() }).strict(),
  );
  await c.env.DB.prepare(
    "INSERT INTO conversation_settings VALUES(?,?,?,?) ON CONFLICT(conversation_id,user_id) DO UPDATE SET muted=excluded.muted,hidden=excluded.hidden",
  )
    .bind(conversation, c.get("userId"), +d.muted, +d.hidden)
    .run();
  return c.json({ data: { saved: true } });
});
messaging.get("/realtime/connect", async (c) => {
  const conversation = c.req.query("conversation_id");
  if (!conversation)
    throw new APIError(400, "CONVERSATION_REQUIRED", "Select a conversation.");
  await membership(c, conversation);
  if (c.req.header("upgrade")?.toLowerCase() !== "websocket")
    throw new APIError(
      426,
      "WEBSOCKET_REQUIRED",
      "Use a WebSocket connection.",
    );
  // Identity headers are overwritten at the Worker boundary, never accepted from the client.
  const headers = new Headers(c.req.raw.headers);
  headers.set("x-user-id", c.get("userId"));
  headers.set("x-conversation-id", conversation);
  return c.env.CHAT.get(c.env.CHAT.idFromName(conversation)).fetch(
    new Request("https://internal/connect", { headers }),
  );
});
export class ChatRoom {
  constructor(
    private state: DurableObjectState,
    private env: Env,
  ) {}
  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === "/disconnect") {
      for (const ws of this.state.getWebSockets())
        ws.close(1008, "Conversation closed");
      return new Response("ok");
    }
    if (path === "/connect") {
      const user = request.headers.get("x-user-id"),
        conversation = request.headers.get("x-conversation-id");
      if (
        !user ||
        !conversation ||
        !(await new D1Conversations(this.env.DB).authorize(conversation, user))
      )
        return new Response("Forbidden", { status: 403 });
      const pair = new WebSocketPair(),
        client = pair[0],
        server = pair[1];
      this.state.acceptWebSocket(server);
      server.serializeAttachment({ user, conversation });
      return new Response(null, { status: 101, webSocket: client });
    }
    if (path === "/send") {
      const d = (await request.json()) as {
        conversation_id: string;
        user_id: string;
        body: string;
        client_id: string;
        reply_to: string | null;
      };
      // The DO serializes send transactions; D1 enforces the idempotency and sequence constraints.
      return this.state.blockConcurrencyWhile(async () => {
        if (
          !(await new D1Conversations(this.env.DB).authorize(
            d.conversation_id,
            d.user_id,
          ))
        )
          return Response.json(
            {
              error: {
                code: "FORBIDDEN",
                message: "Conversation unavailable.",
              },
            },
            { status: 403 },
          );
        const messageId = id();
        const result = await this.env.DB.prepare(
          `INSERT INTO messages(id,conversation_id,sender_id,client_id,body,reply_to,created_at,sequence) SELECT ?,?,?,?,?,?,?,COALESCE(MAX(sequence),0)+1 FROM messages WHERE conversation_id=? HAVING EXISTS(SELECT 1 FROM conversations c JOIN matches m ON m.id=c.match_id JOIN users a ON a.id=m.user_a JOIN users b ON b.id=m.user_b WHERE c.id=? AND m.status='active' AND (m.user_a=? OR m.user_b=?) AND a.status IN ('active','paused') AND b.status IN ('active','paused') AND NOT EXISTS(SELECT 1 FROM blocks WHERE (actor_id=m.user_a AND target_id=m.user_b) OR (actor_id=m.user_b AND target_id=m.user_a))) ON CONFLICT(conversation_id,sender_id,client_id) DO NOTHING`,
        )
          .bind(
            messageId,
            d.conversation_id,
            d.user_id,
            d.client_id,
            d.body,
            d.reply_to,
            now(),
            d.conversation_id,
            d.conversation_id,
            d.user_id,
            d.user_id,
          )
          .run();
        const message = await this.env.DB.prepare(
          "SELECT id,sender_id,body,reply_to,created_at,sequence FROM messages WHERE conversation_id=? AND sender_id=? AND client_id=?",
        )
          .bind(d.conversation_id, d.user_id, d.client_id)
          .first<{ id: string; body: string }>();
        if (!message)
          return Response.json(
            {
              error: {
                code: "FORBIDDEN",
                message: "Conversation unavailable.",
              },
            },
            { status: 403 },
          );
        if (message.body !== d.body)
          return Response.json(
            {
              error: {
                code: "CLIENT_ID_CONFLICT",
                message:
                  "Message identifier is already used for different content.",
              },
            },
            { status: 409 },
          );
        if (result.meta.changes) {
          const match = await this.env.DB.prepare(
            "SELECT * FROM matches WHERE id=?",
          )
            .bind(d.conversation_id)
            .first<MatchRow>();
          await this.env.DB.prepare(
            "INSERT OR IGNORE INTO outbox_events VALUES(?,'message',?,?,?,NULL)",
          )
            .bind(
              messageId,
              messageId,
              JSON.stringify({
                recipient:
                  match?.user_a === d.user_id ? match.user_b : match?.user_a,
                conversation_id: d.conversation_id,
              }),
              now(),
            )
            .run();
          for (const ws of this.state.getWebSockets()) {
            const att = ws.deserializeAttachment() as {
              user: string;
              conversation: string;
            };
            if (
              await new D1Conversations(this.env.DB).authorize(
                att.conversation,
                att.user,
              )
            )
              try {
                ws.send(JSON.stringify({ type: "message", data: message }));
              } catch {
                ws.close();
              }
          }
        }
        return Response.json({ data: message });
      });
    }
    return new Response("Not found", { status: 404 });
  }
  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    if (typeof raw !== "string" || raw.length > 1000) {
      ws.close(1009, "Frame too large");
      return;
    }
    const a = ws.deserializeAttachment() as {
      user: string;
      conversation: string;
    };
    if (
      !(await new D1Conversations(this.env.DB).authorize(
        a.conversation,
        a.user,
      ))
    ) {
      ws.close(1008, "Conversation closed");
      return;
    }
    let msg: unknown;
    try {
      msg = JSON.parse(raw);
    } catch {
      ws.send(JSON.stringify({ type: "error", code: "INVALID_JSON" }));
      return;
    }
    if (
      typeof msg === "object" &&
      msg !== null &&
      "type" in msg &&
      msg.type === "typing"
    ) {
      await limit(this.env, "typing:" + a.user, 12);
      for (const peer of this.state.getWebSockets())
        if (peer !== ws)
          peer.send(JSON.stringify({ type: "typing", user_id: a.user }));
    } else ws.send(JSON.stringify({ type: "error", code: "USE_REST_SEND" }));
  }
  webSocketClose(ws: WebSocket, code: number, reason: string) {
    ws.close(code, reason);
  }
}
