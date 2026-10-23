import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { NavLinks } from "@/components/NavLinks";
import { Badge } from "@/components/ui";
import { plannerName } from "@/lib/env";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Freshroots | Demand Planning",
  description: "Rules-based demand planning with planner approval and Zoho Inventory draft POs.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col font-sans">
        <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
          <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-3 sm:px-6 md:flex-row md:items-center md:justify-between">
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-base font-semibold tracking-tight text-slate-900">
                <span className="text-emerald-700">Freshroots</span> <span className="text-slate-400">|</span> Demand Planning
              </p>
              <Badge className="bg-amber-50 text-amber-800 ring-amber-300">Simulated SAP (Supabase)</Badge>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <NavLinks />
              <span className="text-xs text-slate-500" title="No sign-in: actions are recorded under PLANNER_NAME">
                Planner: {plannerName()}
              </span>
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">{children}</main>
        <footer className="border-t border-slate-200 py-4 text-center text-xs text-slate-500">
          15-SKU demonstration dataset · Supabase stands in for SAP (no live SAP connection) · Rules-based, no AI inference
        </footer>
      </body>
    </html>
  );
}
