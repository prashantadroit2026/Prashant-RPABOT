import { defineHandler } from "nitro";
import { getSql } from "../../../src/lib/db";
import { ensureSeed } from "../../../src/lib/plant-server";

export default defineHandler(async () => {
  const sql = await getSql();
  await ensureSeed(sql);
  const items = await sql<{ id: number; code: string; name: string; uom: string; reorder_level: number; qty: number }>`select * from items order by name`;
  const machines = await sql<{ id: number; code: string; name: string; line: string }>`select * from machines order by code`;
  return {
    items: items.map((r) => ({ id: r.id, code: r.code, name: r.name, uom: r.uom, reorderLevel: r.reorder_level, qty: r.qty })),
    machines: machines.map((r) => ({ id: r.id, code: r.code, name: r.name, line: r.line })),
  };
});
