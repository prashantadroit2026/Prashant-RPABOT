import type { Sql } from "@/lib/db";

export type VendorMap = {
  id: number;
  itemCode: string;
  vendorCode: string;
  vendorDesc: string;
  rate: number | null;
  note: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

type VendorMapRow = {
  id: number;
  item_code: string;
  vendor_code: string;
  vendor_desc: string;
  rate: string | number | null;
  note: string;
  active: boolean;
  created_at: string;
  updated_at: string;
};

function mapVendorMap(r: VendorMapRow): VendorMap {
  return {
    id: r.id,
    itemCode: r.item_code,
    vendorCode: r.vendor_code,
    vendorDesc: r.vendor_desc,
    rate: r.rate === null ? null : Number(r.rate),
    note: r.note,
    active: Boolean(r.active),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

/**
 * Full list of item → TCS vendor mappings (active + inactive), newest first.
 */
export async function listVendorMapsSql(sql: Sql): Promise<VendorMap[]> {
  const rows = await sql.query<VendorMapRow>(
    `select * from tcs_vendor_map order by item_code asc`,
  );
  return rows.map(mapVendorMap);
}

/**
 * Single active mapping for an item code — the fixed vendor (+ optional rate)
 * the TCS RPA bot uses when it raises a PR/PO for that item. Falls back to
 * null so callers can apply the TCS_VENDOR_CODE environment default instead.
 */
export async function resolveVendorMapSql(
  sql: Sql,
  itemCode: string,
): Promise<VendorMap | null> {
  const [row] = await sql.query<VendorMapRow>(
    `select * from tcs_vendor_map where item_code = $1 and active = true limit 1`,
    [itemCode],
  );
  return row ? mapVendorMap(row) : null;
}

/**
 * Upsert an item → vendor mapping for the TCS RPA bot. New links are inserted;
 * an existing row for the same item_code is updated in place and re-activated.
 */
export async function saveVendorMapSql(
  sql: Sql,
  data: {
    itemCode: string;
    vendorCode: string;
    vendorDesc?: string;
    rate?: number | null;
    note?: string;
    active?: boolean;
  },
): Promise<VendorMap> {
  const [row] = await sql.query<VendorMapRow>(
    `insert into tcs_vendor_map (item_code, vendor_code, vendor_desc, rate, note, active)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (item_code) do update set
       vendor_code = excluded.vendor_code,
       vendor_desc = excluded.vendor_desc,
       rate        = excluded.rate,
       note        = excluded.note,
       active      = excluded.active,
       updated_at  = now()
     returning *`,
    [
      String(data.itemCode).trim(),
      String(data.vendorCode).trim(),
      String(data.vendorDesc ?? "").trim(),
      Number.isFinite(data.rate) ? Number(data.rate) : null,
      String(data.note ?? "").trim(),
      data.active ?? true,
    ],
  );
  return mapVendorMap(row);
}

/**
 * Soft-delete — flips the mapping off (active = false) so historic slips keep
 * resolving to a known vendor but new runs skip it.
 */
export async function deactivateVendorMapSql(
  sql: Sql,
  itemCode: string,
): Promise<void> {
  await sql.query(
    `update tcs_vendor_map set active = false, updated_at = now() where item_code = $1`,
    [itemCode],
  );
}