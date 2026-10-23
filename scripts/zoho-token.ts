// One-time Zoho setup for the server-to-server connection.
//
// 1. api-console.zoho.<dc> → Add Client → Self Client. Put its Client ID and
//    Secret in .env.local as ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET, and set
//    ZOHO_ACCOUNTS_DOMAIN / ZOHO_API_DOMAIN to your data centre.
// 2. Self Client → Generate Code with the scope printed by `npm run zoho:token`.
// 3. npm run zoho:token -- <code>            # saves ZOHO_REFRESH_TOKEN (+ org) to .env.local
//    npm run zoho:token -- <code> --vercel   # …and to Vercel production env
//
// The refresh token is written to files / Vercel only, never printed.
import { config } from "dotenv";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { safeAccountsOrigin, safeApiOrigin, ZOHO_SCOPES } from "../lib/zoho/config";

const ENV_FILE = ".env.local";
config({ path: ENV_FILE });

function setEnvLine(key: string, value: string) {
  let text = "";
  try {
    text = readFileSync(ENV_FILE, "utf8");
  } catch {
    /* new file */
  }
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, "m");
  text = re.test(text) ? text.replace(re, line) : `${text.replace(/\n?$/, "\n")}${line}\n`;
  writeFileSync(ENV_FILE, text, { mode: 0o600 });
}

function pushToVercel(key: string, value: string) {
  try {
    execFileSync("npx", ["--yes", "vercel@latest", "env", "add", key, "--environment", "production", "--force"], { input: value, stdio: ["pipe", "ignore", "pipe"] });
  } catch (e) {
    throw new Error(`Vercel env add ${key} failed: ${(e as { stderr?: Buffer }).stderr?.toString().trim() ?? e}`);
  }
  console.log(`✓ Vercel production: ${key} set`);
}

async function main() {
  const args = process.argv.slice(2);
  const code = args.find((a) => !a.startsWith("--"));
  const toVercel = args.includes("--vercel");
  const scope = ZOHO_SCOPES.join(",");
  if (!code) {
    console.log("Usage: npm run zoho:token -- <grant code from Self Client → Generate Code> [--vercel]\n\nScope to paste in Zoho:\n" + scope);
    process.exit(1);
  }
  const clientId = process.env.ZOHO_CLIENT_ID;
  const clientSecret = process.env.ZOHO_CLIENT_SECRET;
  const accounts = safeAccountsOrigin(process.env.ZOHO_ACCOUNTS_DOMAIN ?? "https://accounts.zoho.in");
  if (!clientId || !clientSecret || !accounts) {
    console.error("Set ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET (Self Client) and a valid ZOHO_ACCOUNTS_DOMAIN in .env.local first.");
    process.exit(1);
  }

  const res = await fetch(`${accounts}/oauth/v2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", client_id: clientId, client_secret: clientSecret, code }),
  });
  const t = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; api_domain?: string; scope?: string; error?: string };
  if (!t.refresh_token || !t.access_token) {
    console.error(
      `Zoho did not return a refresh token (${t.error ?? `HTTP ${res.status}`}).` +
        (t.error === "invalid_code" ? " The code is expired or already used — generate a new one (codes last at most 10 minutes and work once)." : "") +
        (t.error === "invalid_client" ? ` The client is not registered in ${accounts}; check ZOHO_ACCOUNTS_DOMAIN and the Self Client ID/secret.` : ""),
    );
    process.exit(1);
  }
  console.log("✓ Refresh token received" + (t.scope ? ` (scope: ${t.scope})` : ""));

  const apiDomain = safeApiOrigin(t.api_domain) ?? safeApiOrigin(process.env.ZOHO_API_DOMAIN ?? "https://www.zohoapis.in")!;
  setEnvLine("ZOHO_REFRESH_TOKEN", t.refresh_token);
  setEnvLine("ZOHO_API_DOMAIN", apiDomain);
  console.log(`✓ ${ENV_FILE}: ZOHO_REFRESH_TOKEN and ZOHO_API_DOMAIN=${apiDomain} saved`);

  const orgRes = await fetch(`${apiDomain}/inventory/v1/organizations`, { headers: { Authorization: `Zoho-oauthtoken ${t.access_token}` } });
  const orgBody = (await orgRes.json().catch(() => ({}))) as { code?: number; message?: string; organizations?: { organization_id: string; name: string }[] };
  const orgs = orgBody.organizations ?? [];
  if (orgBody.code !== 0) console.warn(`! Could not list organisations: ${orgBody.message ?? `HTTP ${orgRes.status}`}`);
  else console.log("Zoho Inventory organisations:", orgs.map((o) => `${o.name} (${o.organization_id})`).join(", ") || "none");
  if (orgs.length === 1) {
    setEnvLine("ZOHO_ORGANIZATION_ID", orgs[0].organization_id);
    console.log(`✓ ${ENV_FILE}: ZOHO_ORGANIZATION_ID=${orgs[0].organization_id}`);
  } else if (orgs.length > 1) {
    console.log(`→ Several organisations: set ZOHO_ORGANIZATION_ID in ${ENV_FILE} (and Vercel) to the one to use.`);
  }

  if (toVercel) {
    const v = (k: string) => process.env[k] ?? "";
    config({ path: ENV_FILE, override: true });
    for (const k of ["ZOHO_CLIENT_ID", "ZOHO_CLIENT_SECRET", "ZOHO_REFRESH_TOKEN", "ZOHO_ACCOUNTS_DOMAIN", "ZOHO_API_DOMAIN", "ZOHO_ORGANIZATION_ID"]) {
      if (v(k)) pushToVercel(k, v(k));
    }
    console.log("Redeploy for Vercel to pick these up: npx vercel deploy --prod");
  }
}

main().catch((e) => {
  console.error("Failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
