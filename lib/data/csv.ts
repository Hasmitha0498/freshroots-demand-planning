// CSV parsing + mapping of the five supplied files to typed rows.
// Used by the seed script and tests only (never at web runtime).

import type { DistributorRow, FestivalRow, InventoryRow, SalesRow, SkuRow, SourceData } from "../planning/types";

/** Minimal RFC-4180 parser (quoted fields, escaped quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => v.trim() !== ""));
}

export interface CsvTable {
  headers: string[];
  records: Record<string, string>[];
}

export function toTable(text: string): CsvTable {
  const [headers = [], ...body] = parseCsv(text);
  const h = headers.map((x) => x.trim());
  return {
    headers: h,
    records: body.map((r) => Object.fromEntries(h.map((k, i) => [k, (r[i] ?? "").trim()]))),
  };
}

export const EXPECTED_HEADERS = {
  sku_master: ["SKU_ID", "SKU_Name", "Category", "Perishability", "Standard_Reorder_Qty", "Unit_of_Measure", "Distributor_ID"],
  weekly_sales: ["SKU_ID", "Week", "Units_Sold"],
  current_inventory: ["SKU_ID", "Location", "Units_On_Hand", "As_Of_Date"],
  distributor_master: ["Distributor_ID", "Distributor_Name", "Region", "Status"],
  festival_calendar: ["Year", "Month", "Year_Month", "Is_Festival_Month"],
} as const;

export type TableName = keyof typeof EXPECTED_HEADERS;

export function headersMatch(headers: string[], expected: readonly string[]): boolean {
  return headers.length === expected.length && expected.every((h, i) => headers[i] === h);
}

/** Identify which source table a CSV is, by its header row (filenames may be arbitrary). */
export function identifyTable(headers: string[]): TableName | null {
  for (const [name, expected] of Object.entries(EXPECTED_HEADERS)) {
    if (headersMatch(headers, expected)) return name as TableName;
  }
  return null;
}

// Numbers that are not clean integers are kept as NaN so validation reports them.
function int(v: string): number {
  return /^-?\d+$/.test(v) ? Number(v) : Number.NaN;
}

function bool(v: string): boolean | null {
  const u = v.toUpperCase();
  if (u === "TRUE") return true;
  if (u === "FALSE") return false;
  return null;
}

export function mapTables(tables: Partial<Record<TableName, CsvTable>>): SourceData {
  return {
    skus: (tables.sku_master?.records ?? []).map(
      (r): SkuRow => ({
        sku_id: r.SKU_ID,
        sku_name: r.SKU_Name,
        category: r.Category,
        perishability: r.Perishability,
        standard_reorder_qty: int(r.Standard_Reorder_Qty),
        unit_of_measure: r.Unit_of_Measure,
        distributor_id: r.Distributor_ID,
      }),
    ),
    sales: (tables.weekly_sales?.records ?? []).map(
      (r): SalesRow => ({ sku_id: r.SKU_ID, week: r.Week, units_sold: int(r.Units_Sold) }),
    ),
    inventory: (tables.current_inventory?.records ?? []).map(
      (r): InventoryRow => ({
        sku_id: r.SKU_ID,
        location: r.Location,
        units_on_hand: int(r.Units_On_Hand),
        as_of_date: r.As_Of_Date,
      }),
    ),
    distributors: (tables.distributor_master?.records ?? []).map(
      (r): DistributorRow => ({
        distributor_id: r.Distributor_ID,
        distributor_name: r.Distributor_Name,
        region: r.Region,
        status: r.Status,
      }),
    ),
    festivals: (tables.festival_calendar?.records ?? []).map(
      (r): FestivalRow => ({
        year: int(r.Year),
        month: int(r.Month),
        year_month: r.Year_Month,
        is_festival_month: bool(r.Is_Festival_Month) as boolean,
      }),
    ),
  };
}
