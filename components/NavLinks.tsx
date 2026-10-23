"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Overview" },
  { href: "/recommendations", label: "Recommendations" },
  { href: "/purchase-orders", label: "Purchase orders" },
];

export function NavLinks() {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="-mx-1 flex min-w-0 gap-0.5 px-1 sm:gap-1">
      {LINKS.map((l) => {
        const active = l.href === "/" ? path === "/" : path.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={`whitespace-nowrap rounded-md px-2 py-1.5 text-sm font-medium sm:px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 ${
              active ? "bg-slate-100 text-slate-900" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
            }`}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
