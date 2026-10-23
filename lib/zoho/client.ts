// Minimal Zoho Inventory REST client. No DB access here — the access token is
// supplied by a callback so this can be unit-tested with a mocked fetch.

export class ZohoApiError extends Error {
  constructor(
    message: string,
    public httpStatus: number,
    public zohoCode: number | null,
    public body: unknown,
  ) {
    super(message);
  }
}

/** The request may or may not have reached Zoho (timeout / network / unreadable reply). */
export class ZohoAmbiguousError extends Error {}

export interface ZohoClientOptions {
  apiDomain: string;
  organizationId?: string | null;
  getAccessToken: () => Promise<string>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface ZohoRequest {
  method?: "GET" | "POST" | "PUT";
  query?: Record<string, string | number | boolean | undefined>;
  json?: unknown;
  /** Organisation-scoped endpoints need organization_id; /organizations does not. */
  withOrg?: boolean;
}

export class ZohoClient {
  constructor(private opts: ZohoClientOptions) {}

  async request<T = Record<string, unknown>>(path: string, req: ZohoRequest = {}): Promise<T> {
    const url = new URL(`${this.opts.apiDomain}/inventory/v1${path}`);
    if (req.withOrg !== false) {
      if (!this.opts.organizationId) throw new ZohoApiError("No Zoho organisation selected.", 400, null, null);
      url.searchParams.set("organization_id", this.opts.organizationId);
    }
    for (const [k, v] of Object.entries(req.query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));

    const token = await this.opts.getAccessToken();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs ?? 20_000);
    let res: Response;
    try {
      res = await (this.opts.fetchImpl ?? fetch)(url, {
        method: req.method ?? "GET",
        headers: {
          Authorization: `Zoho-oauthtoken ${token}`,
          ...(req.json !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: req.json !== undefined ? JSON.stringify(req.json) : undefined,
        signal: controller.signal,
        cache: "no-store",
      });
    } catch (e) {
      throw new ZohoAmbiguousError(
        `No response from Zoho (${e instanceof Error && e.name === "AbortError" ? "timed out" : "network error"}). The request may or may not have been processed.`,
      );
    } finally {
      clearTimeout(timer);
    }

    let body: Record<string, unknown>;
    try {
      body = (await res.json()) as Record<string, unknown>;
    } catch {
      if (res.ok) throw new ZohoAmbiguousError(`Zoho returned HTTP ${res.status} with an unreadable body.`);
      throw new ZohoApiError(`Zoho returned HTTP ${res.status}.`, res.status, null, null);
    }
    const code = typeof body.code === "number" ? body.code : null;
    if (!res.ok || (code !== null && code !== 0)) {
      const msg = typeof body.message === "string" ? body.message : `HTTP ${res.status}`;
      throw new ZohoApiError(`Zoho error${code !== null ? ` ${code}` : ""}: ${msg}`, res.status, code, body);
    }
    return body as T;
  }

  /** Follows page_context.has_more_page up to maxPages. */
  async listAll<T>(path: string, key: string, query: ZohoRequest["query"] = {}, maxPages = 10): Promise<{ rows: T[]; truncated: boolean }> {
    const rows: T[] = [];
    for (let page = 1; page <= maxPages; page++) {
      const body = await this.request<Record<string, unknown>>(path, { query: { ...query, page, per_page: 200 } });
      rows.push(...((body[key] as T[]) ?? []));
      const ctx = body.page_context as { has_more_page?: boolean } | undefined;
      if (!ctx?.has_more_page) return { rows, truncated: false };
    }
    return { rows, truncated: true };
  }
}
