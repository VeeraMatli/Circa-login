import { headers } from "next/headers";
import { NextRequest } from "next/server";
export const dynamic = "force-dynamic";
async function proxy(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  if (path.some((p) => !/^[-_a-zA-Z0-9]+$/.test(p)))
    return Response.json(
      { error: { message: "Invalid path" } },
      { status: 400 },
    );
  if (request.method !== "GET") {
    const origin = request.headers.get("origin");
    const expected = process.env.ADMIN_PUBLIC_ORIGIN ?? request.nextUrl.origin;
    if (origin !== expected)
      return Response.json(
        { error: { message: "Invalid request origin" } },
        { status: 403 },
      );
  }
  const incoming = await headers(),
    forward = new Headers({ "Content-Type": "application/json" });
  if (process.env.ANVAYA_LOCAL_ADMIN === "true") {
    forward.set("x-local-admin", "development");
    forward.set("x-local-role", "super_admin");
  } else {
    const jwt = incoming.get("cf-access-jwt-assertion");
    if (!jwt)
      return Response.json(
        { error: { message: "Sign in through Cloudflare Access with MFA." } },
        { status: 401 },
      );
    forward.set("cf-access-jwt-assertion", jwt);
  }
  try {
    const response = await fetch(
      `${process.env.API_BASE_URL ?? "http://127.0.0.1:8787"}/v1/admin/${path.join("/")}${request.nextUrl.search}`,
      {
        method: request.method,
        headers: forward,
        body: request.method === "GET" ? undefined : await request.text(),
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
      },
    );
    return new Response(response.body, {
      status: response.status,
      headers: {
        "Content-Type":
          response.headers.get("content-type") ?? "application/json",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return Response.json(
      {
        error: {
          message:
            "The API is unavailable. Check the backend service and retry.",
        },
      },
      { status: 503 },
    );
  }
}
export { proxy as GET, proxy as PATCH, proxy as POST };
