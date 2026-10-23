import { NextResponse } from "next/server";
import { route } from "@/lib/server/actor";
import { listItems, listVendors } from "@/lib/zoho/api";
import { asHttpError, zohoClient } from "@/lib/server/zoho";

// Live list of the organisation's existing items and vendors, for mapping.
export const GET = route(async () => {
  const { client } = await zohoClient();
  const [items, vendors] = await Promise.all([listItems(client), listVendors(client)]).catch(asHttpError);
  return NextResponse.json({ items: items.items, vendors: vendors.vendors, truncated: items.truncated || vendors.truncated });
});
