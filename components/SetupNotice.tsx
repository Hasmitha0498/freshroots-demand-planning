import { Notice } from "./ui";

export function SetupNotice({ missing, error }: { missing?: string[]; error?: string }) {
  return (
    <Notice tone="warn" title="Setup needed">
      {missing && missing.length > 0 && (
        <p>
          Missing server environment variables: <code className="font-mono">{missing.join(", ")}</code>. Add them to{" "}
          <code className="font-mono">.env.local</code> (or Vercel → Settings → Environment Variables).
        </p>
      )}
      {error && (
        <p className="mt-1">
          Database error: <code className="font-mono">{error}</code>. If tables are missing, run <code className="font-mono">npm run db:migrate</code> (or paste{" "}
          <code className="font-mono">supabase/migrations/0001_init.sql</code> into the Supabase SQL editor), then <code className="font-mono">npm run db:seed</code>.
        </p>
      )}
    </Notice>
  );
}
