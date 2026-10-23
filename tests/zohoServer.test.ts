// Server-side Zoho connection (refresh token from env) with a mocked fetch.
// Not a live Zoho test.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function setEnv(extra: Record<string, string> = {}) {
  Object.assign(process.env, {
    ZOHO_CLIENT_ID: "1000.client",
    ZOHO_CLIENT_SECRET: "secret",
    ZOHO_REFRESH_TOKEN: "1000.refresh",
    ZOHO_ACCOUNTS_DOMAIN: "https://accounts.zoho.com",
    ZOHO_API_DOMAIN: "https://www.zohoapis.com",
    ...extra,
  });
}

async function load() {
  vi.resetModules(); // fresh token/org caches per test
  return import("@/lib/server/zoho");
}

beforeEach(() => {
  delete process.env.ZOHO_ORGANIZATION_ID;
  setEnv();
});
afterEach(() => vi.unstubAllGlobals());

describe("server-side Zoho connection", () => {
  it("reports missing credentials without calling Zoho", async () => {
    delete process.env.ZOHO_REFRESH_TOKEN;
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    const { getZohoStatus } = await load();
    const s = await getZohoStatus();
    expect(s).toMatchObject({ configured: false, live: false, missing: ["ZOHO_REFRESH_TOKEN"] });
    expect(f).not.toHaveBeenCalled();
  });

  it("refreshes once, uses the single organisation, and caches both", async () => {
    const f = vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.startsWith("https://accounts.zoho.com/oauth/v2/token")) return json({ access_token: "tok", expires_in: 3600 });
      if (u.includes("/inventory/v1/organizations")) return json({ code: 0, organizations: [{ organization_id: "777", name: "Freshroots Demo" }] });
      throw new Error(`unexpected ${u}`);
    });
    vi.stubGlobal("fetch", f);
    const { getZohoStatus, zohoClient } = await load();
    expect(await getZohoStatus()).toMatchObject({ configured: true, live: true, organization_id: "777", organization_name: "Freshroots Demo" });
    const c = await zohoClient();
    expect(c.organizationId).toBe("777");
    expect(f).toHaveBeenCalledTimes(2); // 1 token + 1 organisations, then cached
    const [, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(init.body)).toContain("grant_type=refresh_token");
  });

  it("requires ZOHO_ORGANIZATION_ID when the account has several organisations", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) =>
        String(url).includes("oauth") ? json({ access_token: "tok" }) : json({ code: 0, organizations: [{ organization_id: "1", name: "A" }, { organization_id: "2", name: "B" }] }),
      ),
    );
    let mod = await load();
    let s = await mod.getZohoStatus();
    expect(s.live).toBe(false);
    expect(s.error).toMatch(/set ZOHO_ORGANIZATION_ID to one of: A \(1\), B \(2\)/);
    process.env.ZOHO_ORGANIZATION_ID = "2";
    mod = await load();
    s = await mod.getZohoStatus();
    expect(s).toMatchObject({ live: true, organization_id: "2", organization_name: "B" });
  });

  it("surfaces a rejected refresh token clearly", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: "invalid_code" })));
    const { getZohoStatus } = await load();
    const s = await getZohoStatus();
    expect(s).toMatchObject({ configured: true, live: false });
    expect(s.error).toMatch(/invalid_code/);
    expect(s.error).not.toContain("1000.refresh");
  });

  it("concurrent requests share one token refresh", async () => {
    let tokenCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        if (String(url).includes("oauth")) {
          tokenCalls++;
          await new Promise((r) => setTimeout(r, 10));
          return json({ access_token: "tok" });
        }
        return json({ code: 0, organizations: [{ organization_id: "777", name: "X" }] });
      }),
    );
    const { getZohoStatus } = await load();
    await Promise.all([getZohoStatus(), getZohoStatus(), getZohoStatus()]);
    expect(tokenCalls).toBe(1);
  });
});
