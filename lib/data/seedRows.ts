import { parseIsoWeek } from "../planning/isoWeek";
import type { SourceData } from "../planning/types";

/** Maps validated source data to DB rows (adds iso_year/iso_week for safe sorting). */
export function buildSeedRows(data: SourceData) {
  return {
    distributor_master: data.distributors,
    sku_master: data.skus,
    weekly_sales: data.sales.map((r) => {
      const w = parseIsoWeek(r.week);
      if (!w) throw new Error(`Malformed ISO week ${r.week}`);
      return { sku_id: r.sku_id, week: r.week, iso_year: w.year, iso_week: w.week, units_sold: r.units_sold };
    }),
    current_inventory: data.inventory,
    festival_calendar: data.festivals.map((f) => ({
      year_month: f.year_month,
      year: f.year,
      month: f.month,
      is_festival_month: f.is_festival_month,
    })),
  };
}

/** Upsert order respects foreign keys. Conflict targets are the primary keys. */
export const SEED_ORDER = [
  ["distributor_master", "distributor_id"],
  ["sku_master", "sku_id"],
  ["weekly_sales", "sku_id,week"],
  ["current_inventory", "sku_id"],
  ["festival_calendar", "year_month"],
] as const;
