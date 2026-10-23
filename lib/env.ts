// Central place for configuration checks. All Supabase and Zoho access is
// server-side; nothing here is sent to the browser.

export function supabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export function missingSupabaseEnv(): string[] {
  return ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"].filter((k) => !process.env[k]);
}

/** Name recorded on runs, approvals and POs (there is no sign-in). */
export function plannerName(): string {
  return process.env.PLANNER_NAME?.trim() || "Demand Planner";
}
