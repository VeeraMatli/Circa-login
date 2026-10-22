import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { z } from "zod";
import { authentication } from "./auth";
import { profiles } from "./profiles";
import { discovery } from "./discovery";
import { messaging } from "./messaging";
import { media } from "./media";
import { safety } from "./safety";
import { administration } from "./admin";
import { purchases } from "./purchases";
import { APIError, id } from "./domain";
import { dispatch, processQueue } from "./workers";
import type { AppEnv, Env } from "./types";
export { ChatRoom } from "./messaging";
const app = new Hono<AppEnv>();
app.use("*", async (c, next) => {
  const trace = id();
  c.set("traceId", trace);
  c.header("X-Trace-ID", trace);
  c.header("Cache-Control", "no-store");
  await next();
});
app.use("*", secureHeaders());
app.use(
  "/v1/*",
  cors({
    origin: (origin, c) => (origin === c.env.ADMIN_ORIGIN ? origin : null),
    allowHeaders: [
      "Authorization",
      "Content-Type",
      "Idempotency-Key",
      "X-Upload-Token",
    ],
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "PUT", "OPTIONS"],
    maxAge: 600,
  }),
);
app.onError((error, c) => {
  const known = error instanceof APIError;
  const validation = error instanceof z.ZodError;
  if (!known && !validation)
    console.error(
      JSON.stringify({
        event: "request_error",
        trace_id: c.get("traceId"),
        error_type: error.name,
      }),
    );
  return c.json(
    {
      error: {
        code: known
          ? error.code
          : validation
            ? "VALIDATION_ERROR"
            : "INTERNAL_ERROR",
        message: known
          ? error.message
          : validation
            ? "Invalid input."
            : "Unable to complete this request.",
        trace_id: c.get("traceId"),
      },
    },
    (known ? error.status : validation ? 400 : 500) as 400,
  );
});
app.notFound((c) =>
  c.json(
    {
      error: {
        code: "NOT_FOUND",
        message: "Route not found.",
        trace_id: c.get("traceId"),
      },
    },
    404,
  ),
);
app.get("/health", async (c) => {
  await c.env.DB.prepare("SELECT 1 FROM users LIMIT 1").first();
  return c.json({
    data: {
      status: "ok",
      service: "anvaya-api",
      mode: c.env.LOCAL_MODE === "true" ? "local-mocks" : "production",
    },
  });
});
app.route("/v1/auth", authentication);
app.route("/v1", profiles);
app.route("/v1", discovery);
app.route("/v1", messaging);
app.route("/v1", media);
app.route("/v1", safety);
app.route("/v1", purchases);
app.route("/v1/admin", administration);
export default {
  fetch: app.fetch,
  queue: processQueue,
  scheduled: async (_event: ScheduledController, env: Env) => dispatch(env),
};
