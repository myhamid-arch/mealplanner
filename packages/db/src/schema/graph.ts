// 02 §8 Knowledge graph; household_id null = global (KG-2).
import { index, jsonb, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import type { Json } from "@mealplanner/core/types";
import { num, tstz } from "./columns.js";
import { kgEdgeSource } from "./enums.js";
import { household } from "./tenancy.js";

export const kgNode = pgTable(
  "kg_node",
  {
    id: uuid("id").primaryKey(),
    householdId: uuid("household_id").references(() => household.id),
    type: text("type").notNull(),
    key: text("key").notNull(),
    label: text("label").notNull(),
    props: jsonb("props").$type<Json>().notNull(),
  },
  (t) => [
    index("kg_node_household_id_idx").on(t.householdId),
    unique("kg_node_household_type_key_key").on(t.householdId, t.type, t.key).nullsNotDistinct(),
  ],
);

export const kgEdge = pgTable(
  "kg_edge",
  {
    id: uuid("id").primaryKey(),
    householdId: uuid("household_id").references(() => household.id),
    srcId: uuid("src_id")
      .notNull()
      .references(() => kgNode.id),
    dstId: uuid("dst_id")
      .notNull()
      .references(() => kgNode.id),
    type: text("type").notNull(),
    weight: num("weight").notNull(),
    props: jsonb("props").$type<Json>().notNull(),
    source: kgEdgeSource("source").notNull(),
    updatedAt: tstz("updated_at").notNull(),
  },
  (t) => [
    index("kg_edge_household_id_idx").on(t.householdId),
    index("kg_edge_src_id_type_idx").on(t.srcId, t.type),
    index("kg_edge_dst_id_type_idx").on(t.dstId, t.type),
    unique("kg_edge_household_src_dst_type_key")
      .on(t.householdId, t.srcId, t.dstId, t.type)
      .nullsNotDistinct(),
  ],
);
