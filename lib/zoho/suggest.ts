// Mapping suggestion only — the planner still confirms every mapping.
const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

/** Zoho item whose SKU field equals the SKU_ID; vendor whose name equals the CSV distributor name. */
export function suggestMapping<I extends { sku: string | null }, V extends { contact_name: string; company_name: string | null }>(
  sku: { sku_id: string; distributor_name: string | null },
  catalog: { items: I[]; vendors: V[] },
): { item?: I; vendor?: V } {
  const item = catalog.items.find((i) => norm(i.sku) === norm(sku.sku_id));
  const vendor = sku.distributor_name
    ? catalog.vendors.find((v) => norm(v.contact_name) === norm(sku.distributor_name) || norm(v.company_name) === norm(sku.distributor_name))
    : undefined;
  return { item, vendor };
}
