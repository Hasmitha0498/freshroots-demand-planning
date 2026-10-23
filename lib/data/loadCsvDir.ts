// Node-only: read every *.csv in a directory and identify tables by headers.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { identifyTable, mapTables, toTable, type CsvTable, type TableName } from "./csv";
import type { SourceData } from "../planning/types";

export interface LoadedCsvDir {
  data: SourceData;
  files: Partial<Record<TableName, string>>;
  missing: TableName[];
  unrecognised: string[];
}

export function loadCsvDir(dir: string): LoadedCsvDir {
  const tables: Partial<Record<TableName, CsvTable>> = {};
  const files: Partial<Record<TableName, string>> = {};
  const unrecognised: string[] = [];
  for (const name of readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".csv")).sort()) {
    const table = toTable(readFileSync(join(dir, name), "utf8"));
    const kind = identifyTable(table.headers);
    if (!kind) {
      unrecognised.push(name);
      continue;
    }
    if (files[kind]) throw new Error(`Two files look like ${kind}: ${files[kind]} and ${name}`);
    tables[kind] = table;
    files[kind] = name;
  }
  const all: TableName[] = ["sku_master", "weekly_sales", "current_inventory", "distributor_master", "festival_calendar"];
  return { data: mapTables(tables), files, missing: all.filter((t) => !files[t]), unrecognised };
}
