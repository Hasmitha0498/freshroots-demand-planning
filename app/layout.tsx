import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AboutPilot } from "@/components/AboutPilot";
import { NavLinks } from "@/components/NavLinks";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Freshroots | Demand Planning",
  description: "See which products need attention, approve reorders and create purchase orders in Zoho Inventory.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col overflow-x-hidden font-sans">
        <header className="sticky top-0 z-20 border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2.5 sm:px-6">
            <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <span aria-hidden className="grid h-6 w-6 place-items-center rounded-md bg-emerald-700 text-xs font-bold text-white">F</span>
              Freshroots <span className="font-normal text-slate-400">Demand Planning</span>
            </p>
            <NavLinks />
          </div>
        </header>
        <main className="mx-auto w-full min-w-0 max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8">{children}</main>
        <footer className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-5 text-xs text-slate-400 sm:px-6">
          <span>Demo data · Rules-based planning</span>
          <AboutPilot />
        </footer>
      </body>
    </html>
  );
}
