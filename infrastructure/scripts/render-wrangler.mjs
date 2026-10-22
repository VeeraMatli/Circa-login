import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "jsonc-parser";
const environment = process.argv[2];
if (!["staging", "production"].includes(environment))
  throw new Error("Choose staging or production explicitly.");
const require = (key) => {
  const value = process.env[key];
  if (!value || value.includes("example.invalid"))
    throw new Error(`Set ${key} to an actual provisioned resource or value.`);
  return value;
};
const origin = require("ADMIN_PUBLIC_ORIGIN");
if (!origin.startsWith("https://"))
  throw new Error("Admin origin must be HTTPS");
const parseErrors = [];
const config = parse(
  readFileSync("services/api/wrangler.jsonc", "utf8"),
  parseErrors,
  { allowTrailingComma: true },
);
if (parseErrors.length)
  throw new Error("Invalid Wrangler JSONC configuration.");
delete config.env;
delete config.$schema;
config.name = `anvaya-api-${environment}`;
config.account_id = require("CLOUDFLARE_ACCOUNT_ID");
config.main = resolve("services/api/src/index.ts");
config.vars = {
  LOCAL_MODE: "false",
  APPLE_BUNDLE_ID: require("APPLE_BUNDLE_ID"),
  ADMIN_ORIGIN: origin,
};
config.d1_databases = [
  {
    binding: "DB",
    database_name: `anvaya-${environment}`,
    database_id: require("D1_DATABASE_ID"),
    migrations_dir: resolve("services/api/migrations"),
  },
];
config.r2_buckets = [
  { binding: "MEDIA", bucket_name: require("R2_BUCKET_NAME") },
];
config.queues = {
  producers: [{ binding: "EVENTS", queue: require("EVENTS_QUEUE_NAME") }],
  consumers: [
    {
      queue: require("EVENTS_QUEUE_NAME"),
      max_batch_size: 10,
      max_retries: 3,
      dead_letter_queue: require("DLQ_NAME"),
    },
  ],
};
config.routes = [{ pattern: require("API_HOSTNAME"), custom_domain: true }];
mkdirSync(".wrangler", { recursive: true });
const path = `.wrangler/deploy.${environment}.json`;
writeFileSync(path, JSON.stringify(config, null, 2) + "\n");
console.log(`Rendered ${path}; LOCAL_MODE=false. No credentials written.`);
