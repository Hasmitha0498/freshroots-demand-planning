import { describe, expect, it, vi } from "vitest";
import { ZohoAmbiguousError, ZohoApiError, ZohoClient } from "@/lib/zoho/client";
import { createPurchaseOrder, listVendors, parseCreatedPo } from "@/lib/zoho/api";
import { buildPoPayload, compareCreatedLines, validatePoLines, type PoLineInput } from "@/lib/zoho/po";
import { suggestMapping } from "@/lib/zoho/suggest";
import { safeAccountsOrigin, safeApiOrigin, zohoPoWebLink } from "@/lib/zoho/config";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function client(fetchImpl: typeof fetch) {
  return new ZohoClient({ apiDomain: "https://www.zohoapis.in", organizationId: "600", getAccessToken: async () => "tok", fetchImpl, timeoutMs: 50 });
}

const line = (over: Partial<PoLineInput> = {}): PoLineInput => ({
  recommendation_id: "r1",
  sku_id: "SKU001",
  sku_name: "Mango",
  zoho_item_id: "i1",
  zoho_item_name: "Mango 200ml",
  zoho_vendor_id: "v1",
  quantity: 750,
  purchase_rate: 12.5,
  ...over,
});

describe("Zoho client (mocked — not a live integration test)", () => {
  it("sends the OAuth header, org id and JSON body", async () => {
    const f = vi.fn(async () => json({ code: 0, message: "success", purchase_order: { purchaseorder_id: 99, purchaseorder_number: "PO-1", status: "draft", line_items: [{ item_id: "i1", quantity: 750, rate: 12.5 }] } }));
    const po = await createPurchaseOrder(client(f as unknown as typeof fetch), { vendor_id: "v1" }, false);
    const [url, init] = f.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe("https://www.zohoapis.in/inventory/v1/purchaseorders?organization_id=600");
    expect((init.headers as Record<string, string>).Authorization).toBe("Zoho-oauthtoken tok");
    expect(init.method).toBe("POST");
    expect(po).toMatchObject({ purchaseorder_id: "99", purchaseorder_number: "PO-1", status: "draft" });
  });

  it("adds ignore_auto_number_generation only for manual numbers", async () => {
    const f = vi.fn(async () => json({ code: 0, purchaseorder: { purchaseorder_id: "1" } }));
    await createPurchaseOrder(client(f as unknown as typeof fetch), {}, true);
    expect(String((f.mock.calls[0] as unknown[])[0])).toContain("ignore_auto_number_generation=true");
  });

  it("surfaces Zoho error codes as definitive API errors", async () => {
    const f = vi.fn(async () => json({ code: 4000, message: "Vendor is inactive" }, 400));
    const err = await createPurchaseOrder(client(f as unknown as typeof fetch), {}, false).catch((e) => e);
    expect(err).toBeInstanceOf(ZohoApiError);
    expect(err.message).toContain("Vendor is inactive");
  });

  it("treats timeouts and network failures as ambiguous", async () => {
    const hang = vi.fn((_u: unknown, init: RequestInit) => new Promise<Response>((_, rej) => init.signal!.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" })))));
    await expect(createPurchaseOrder(client(hang as unknown as typeof fetch), {}, false)).rejects.toBeInstanceOf(ZohoAmbiguousError);
    const down = vi.fn(async () => { throw new TypeError("fetch failed"); });
    await expect(createPurchaseOrder(client(down as unknown as typeof fetch), {}, false)).rejects.toBeInstanceOf(ZohoAmbiguousError);
  });

  it("treats success without a PO id as ambiguous", () => {
    expect(() => parseCreatedPo({ code: 0, message: "success" })).toThrow(ZohoAmbiguousError);
  });

  it("pages through contacts and keeps vendors only", async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(json({ code: 0, contacts: [{ contact_id: "1", contact_name: "Cust", contact_type: "customer" }], page_context: { has_more_page: true } }))
      .mockResolvedValueOnce(json({ code: 0, contacts: [{ contact_id: "2", contact_name: "Vend", contact_type: "vendor" }], page_context: { has_more_page: false } }));
    const { vendors } = await listVendors(client(f as unknown as typeof fetch));
    expect(vendors.map((v) => v.contact_id)).toEqual(["2"]);
    expect(f).toHaveBeenCalledTimes(2);
  });
});

describe("PO payload", () => {
  it("validates lines: single vendor, positive whole qty, positive rate, no duplicate items", () => {
    expect(validatePoLines("v1", [line()])).toEqual([]);
    expect(validatePoLines("v1", [line(), line({ recommendation_id: "r2", sku_id: "SKU002", zoho_vendor_id: "v2", zoho_item_id: "i2" })]).join()).toMatch(/different Zoho vendor/);
    expect(validatePoLines("v1", [line({ quantity: 0 })]).join()).toMatch(/quantity/);
    expect(validatePoLines("v1", [line({ purchase_rate: 0 })]).join()).toMatch(/rate/);
    expect(validatePoLines("v1", [line(), line({ recommendation_id: "r2", sku_id: "SKU002" })]).join()).toMatch(/appears twice/);
    expect(validatePoLines("v1", [])).toContain("No approved lines to order.");
  });

  it("builds a draft payload and flags mismatches in Zoho's reply", () => {
    const p = buildPoPayload({ vendor_id: "v1", reference_number: "FR-1", date: "2026-10-23", notes: "n", lines: [line()] });
    expect(p).toEqual({ vendor_id: "v1", reference_number: "FR-1", date: "2026-10-23", notes: "n", line_items: [{ item_id: "i1", quantity: 750, purchase_rate: 12.5, rate: 12.5 }] });
    expect(p).not.toHaveProperty("purchaseorder_number");
    expect(buildPoPayload({ vendor_id: "v1", reference_number: "FR-1", date: "d", notes: "", lines: [line()], purchaseorder_number: " PO-9 " }).purchaseorder_number).toBe("PO-9");
    expect(compareCreatedLines(p.line_items, [{ item_id: "i1", quantity: 750, rate: 12.5 }])).toEqual([]);
    expect(compareCreatedLines(p.line_items, [{ item_id: "i1", quantity: 750, rate: 0 }]).join()).toMatch(/rate 0/);
  });
});

describe("security helpers", () => {
  it("only accepts Zoho hosts for regional domains", () => {
    expect(safeAccountsOrigin("https://accounts.zoho.in")).toBe("https://accounts.zoho.in");
    expect(safeAccountsOrigin("https://accounts.zoho.in.evil.com")).toBeNull();
    expect(safeAccountsOrigin("http://accounts.zoho.in")).toBeNull();
    expect(safeApiOrigin("https://www.zohoapis.in")).toBe("https://www.zohoapis.in");
    expect(safeApiOrigin("https://zohoapis.attacker.io")).toBeNull();
    expect(zohoPoWebLink("https://www.zohoapis.in", "600", "99")).toBe("https://inventory.zoho.in/app/600#/purchaseorders/99");
  });
});

describe("mapping suggestion", () => {
  const catalog = {
    items: [
      { item_id: "i1", sku: "SKU001" },
      { item_id: "i3", sku: " sku003 " },
      { item_id: "ix", sku: null },
    ],
    vendors: [
      { contact_id: "v1", contact_name: "NutriFlow Distributors", company_name: null },
      { contact_id: "v2", contact_name: "GP", company_name: "GrainPath Logistics" },
    ],
  };
  it("matches item by SKU field and vendor by name, case-insensitively", () => {
    const a = suggestMapping({ sku_id: "SKU001", distributor_name: "nutriflow distributors" }, catalog);
    expect([a.item?.item_id, a.vendor?.contact_id]).toEqual(["i1", "v1"]);
    const b = suggestMapping({ sku_id: "SKU003", distributor_name: "GrainPath Logistics" }, catalog);
    expect([b.item?.item_id, b.vendor?.contact_id]).toEqual(["i3", "v2"]);
  });
  it("suggests nothing when there is no exact match", () => {
    const c = suggestMapping({ sku_id: "SKU999", distributor_name: "Unknown Co" }, catalog);
    expect(c).toEqual({ item: undefined, vendor: undefined });
  });
});
