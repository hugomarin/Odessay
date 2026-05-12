import fs from "node:fs";

const args = process.argv.slice(2);
let envPath = ".env.local";
let templateMode = false;

for (const arg of args) {
  if (arg === "--template") {
    templateMode = true;
    continue;
  }

  envPath = arg;
}

const requiredKeys = [
  "NEXT_PUBLIC_APP_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "ANTHROPIC_API_KEY",
];

function parseEnvFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = {};

  for (const rawLine of raw.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    parsed[key] = value;
  }

  return parsed;
}

if (!fs.existsSync(envPath)) {
  console.error(`Missing ${envPath}. Create it from .env.example first.`);
  process.exit(1);
}

const env = parseEnvFile(envPath);
const missing = templateMode
  ? requiredKeys.filter((key) => !(key in env))
  : requiredKeys.filter((key) => !env[key]);
const appUrl = env.NEXT_PUBLIC_APP_URL;
const hasSupabasePublicKey = templateMode
  ? "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY" in env ||
    "NEXT_PUBLIC_SUPABASE_ANON_KEY" in env
  : Boolean(
      env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||
        env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    );

if (missing.length > 0) {
  console.error(`Missing required env vars in ${envPath}:`);
  for (const key of missing) {
    console.error(`- ${key}`);
  }
  process.exit(1);
}

if (!hasSupabasePublicKey) {
  console.error(`Missing required env var in ${envPath}:`);
  console.error(
    "- NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY",
  );
  process.exit(1);
}

if (!templateMode && !/^https?:\/\//.test(appUrl)) {
  console.error(
    `NEXT_PUBLIC_APP_URL must start with http:// or https:// (current: ${appUrl})`,
  );
  process.exit(1);
}

console.log(
  templateMode
    ? `Template check passed for ${envPath}.`
    : `Environment check passed for ${envPath}.`,
);
