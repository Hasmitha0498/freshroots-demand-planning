import { parseIsoWeek } from "./isoWeek";
import type { DataIssue, SourceData } from "./types";

export const PERISHABILITY_VALUES = ["High", "Medium", "Low"] as const;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const YEAR_MONTH_RE = /^(\d{4})-(\d{2})$/;

export function isValidDate(value: string): boolean {
  if (!DATE_RE.test(value ?? "")) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function blank(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === "string" && v.trim() === "");
}

function isNonNegativeInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0;
}

export interface ValidationResult {
  issues: DataIssue[];
  /** SKUs whose own data is invalid; the engine marks them insufficient_data. */
  invalidSkus: Set<string>;
}

/**
 * Validates the five source tables: primary keys, references, duplicates,
 * malformed ISO weeks, negative values, nulls and festival metadata.
 */
export function validateSourceData(src: SourceData): ValidationResult {
  const issues: DataIssue[] = [];
  const invalidSkus = new Set<string>();
  const err = (table: string, key: string, message: string, sku?: string) => {
    issues.push({ severity: "error", table, key, message });
    if (sku) invalidSkus.add(sku);
  };
  const warn = (table: string, key: string, message: string) =>
    issues.push({ severity: "warning", table, key, message });

  // distributor_master
  const distIds = new Set<string>();
  for (const d of src.distributors) {
    if (blank(d.distributor_id)) {
      err("distributor_master", "?", "Missing Distributor_ID");
      continue;
    }
    if (distIds.has(d.distributor_id)) err("distributor_master", d.distributor_id, "Duplicate Distributor_ID");
    distIds.add(d.distributor_id);
    if (blank(d.distributor_name)) err("distributor_master", d.distributor_id, "Missing Distributor_Name");
  }

  // sku_master
  const skuIds = new Set<string>();
  for (const s of src.skus) {
    if (blank(s.sku_id)) {
      err("sku_master", "?", "Missing SKU_ID");
      continue;
    }
    if (skuIds.has(s.sku_id)) err("sku_master", s.sku_id, "Duplicate SKU_ID", s.sku_id);
    skuIds.add(s.sku_id);
    if (blank(s.sku_name)) err("sku_master", s.sku_id, "Missing SKU_Name", s.sku_id);
    if (!PERISHABILITY_VALUES.includes(s.perishability as (typeof PERISHABILITY_VALUES)[number]))
      err("sku_master", s.sku_id, `Unknown Perishability "${s.perishability}"`, s.sku_id);
    if (!(Number.isInteger(s.standard_reorder_qty) && s.standard_reorder_qty > 0))
      err("sku_master", s.sku_id, "Standard_Reorder_Qty must be a positive whole number", s.sku_id);
    if (blank(s.distributor_id) || !distIds.has(s.distributor_id))
      err("sku_master", s.sku_id, `Distributor_ID "${s.distributor_id}" not found in distributor_master`, s.sku_id);
  }

  // weekly_sales
  const seenWeek = new Set<string>();
  for (const r of src.sales) {
    const key = `${r.sku_id}/${r.week}`;
    if (!skuIds.has(r.sku_id)) {
      err("weekly_sales", key, "SKU_ID not found in sku_master");
      continue;
    }
    if (!parseIsoWeek(r.week)) err("weekly_sales", key, `Malformed ISO week "${r.week}"`, r.sku_id);
    if (!isNonNegativeInt(r.units_sold))
      err("weekly_sales", key, "Units_Sold must be a non-negative whole number", r.sku_id);
    if (seenWeek.has(key)) err("weekly_sales", key, "Duplicate SKU/week row", r.sku_id);
    seenWeek.add(key);
  }

  // current_inventory
  const invSkus = new Set<string>();
  const asOfDates = new Set<string>();
  for (const r of src.inventory) {
    if (!skuIds.has(r.sku_id)) {
      err("current_inventory", r.sku_id, "SKU_ID not found in sku_master");
      continue;
    }
    if (invSkus.has(r.sku_id)) err("current_inventory", r.sku_id, "Duplicate inventory row for SKU", r.sku_id);
    invSkus.add(r.sku_id);
    if (!isNonNegativeInt(r.units_on_hand))
      err("current_inventory", r.sku_id, "Units_On_Hand must be a non-negative whole number", r.sku_id);
    if (!isValidDate(r.as_of_date)) err("current_inventory", r.sku_id, `Invalid As_Of_Date "${r.as_of_date}"`, r.sku_id);
    else asOfDates.add(r.as_of_date);
  }
  for (const id of skuIds) {
    if (!invSkus.has(id)) err("current_inventory", id, "No inventory record for SKU", id);
  }
  if (asOfDates.size > 1)
    warn("current_inventory", "*", `Inventory rows have mixed As_Of_Date values (${[...asOfDates].sort().join(", ")}); latest is used as the snapshot date`);

  // festival_calendar
  const months = new Set<string>();
  for (const f of src.festivals) {
    const m = YEAR_MONTH_RE.exec(f.year_month ?? "");
    if (!m) {
      err("festival_calendar", String(f.year_month), "Malformed Year_Month");
      continue;
    }
    if (months.has(f.year_month)) err("festival_calendar", f.year_month, "Duplicate Year_Month");
    months.add(f.year_month);
    if (Number(m[1]) !== f.year || Number(m[2]) !== f.month)
      err("festival_calendar", f.year_month, "Year/Month columns disagree with Year_Month");
    if (typeof f.is_festival_month !== "boolean")
      err("festival_calendar", f.year_month, "Is_Festival_Month must be TRUE or FALSE");
  }

  return { issues, invalidSkus };
}
