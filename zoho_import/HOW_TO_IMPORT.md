# Set up the demo Zoho Inventory organisation

Use these steps in a **test** Zoho Inventory organisation (here: MESA Freshroots).

- `vendors.csv` creates the 4 distributors from `data/distributor_master.csv` as Zoho vendors.
- `items.csv` creates the 15 SKUs from `data/sku_master.csv` as Zoho items. The SKU code goes in Zoho's **SKU** field, so the app can suggest the mapping.
- **Prices are DEMO test values**, not Freshroots' real costs. Replace them with the real costs if you have them. You also confirm every price in the app before any PO is created.

Import the vendors first, because the items refer to them.

## 1. Import the vendors (about 1 minute)

1. Open https://inventory.zoho.com and check that the organisation in the top-right is **MESA Freshroots**.
2. In the left menu, go to **Purchases → Vendors**.
3. Click the **⋯ (More)** menu at the top right and choose **Import Vendors**.
4. **Upload file:** `zoho_import/vendors.csv`. Character encoding: **UTF-8**. Field delimiter: **comma**. Click **Next**.
5. **Map fields.** Zoho usually maps them automatically; check these:
   - Display Name → **Display Name**
   - Company Name → **Company Name**
   - Billing State → **Billing State**
   - Notes → **Notes** (or leave unmapped)
6. Click **Next**, then **Import**. You should see 4 vendors: NutriFlow Distributors, GrainPath Logistics, PeakSource Supply and Meridian Trade Co.

## 2. Import the items (about 2 minutes)

1. In the left menu, go to **Items → Items**.
2. Click **⋯ (More)** and choose **Import Items**.
3. **Upload file:** `zoho_import/items.csv`. Use UTF-8 and comma again. Click **Next**.
4. **Map fields:**
   - Item Name → **Item Name**
   - SKU → **SKU**
   - Unit → **Unit**
   - Product Type → **Product Type** (goods)
   - Item Type → **Item Type** (Sales and Purchases)
   - Purchase Rate → **Purchase Rate** (may be labelled **Cost Price**)
   - Rate → **Rate** (may be labelled **Selling Price**)
   - Preferred Vendor → **Preferred Vendor**. Leave it unmapped if Zoho doesn't offer it; it's optional.
   - Purchase Description → **Purchase Description**. This is optional.
5. Click **Next**, then **Import**. You should see 15 items, SKU001 to SKU015.

## If the import screen differs

Zoho sometimes renames menus. You can also add the records by hand.

**Vendor:** Purchases → Vendors → **+ New**. Enter the Display Name and Company Name, then **Save**.

**Item:** Items → **+ New**:
- Type: **Goods**
- Name and SKU from the CSV
- Unit: **pcs**
- Under **Sales Information**, enter the Selling Price.
- Under **Purchase Information**, enter the Cost Price and choose the Preferred Vendor.
- Turn **Track Inventory** off.
- Click **Save**.

For the test PO, you only need **SKU001** and **SKU003** plus their vendors, **NutriFlow Distributors** and **GrainPath Logistics**.

## 3. Map and create the test PO in the app

1. Open https://freshroots-demand-planning-one-gamma.vercel.app/purchase-orders.
2. Click **Load Zoho items & vendors**. Each SKU now pre-selects its item (matched by SKU) and its vendor (matched by distributor name), with the Zoho cost price.
3. Check each pre-selection and click **Confirm mapping** for SKU001 and SKU003.
4. Under **Approved reorders ready for Zoho**, each vendor gets its own group. Click **Review draft PO**, check the lines, then click **Create Draft PO in Zoho**.
5. Open the Zoho PO number shown in **Purchase order history**. In Zoho it appears under **Purchases → Purchase Orders** as a **Draft**.
