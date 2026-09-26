// 02 §7 Agent, proposals, change log.
import { foreignKey, index, jsonb, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import type { Json } from "@mealplanner/core/types";
import { tstz } from "./columns.js";
import { changeActor, changeSource, chatRole, proposalOrigin, proposalStatus } from "./enums.js";
import { household, user } from "./tenancy.js";

const householdIdColumn = () =>
  uuid("household_id")
    .notNull()
    .references(() => household.id);

export const conversation = pgTable(
  "conversation",
  {
    id: uuid("id").primaryKey(),
    householdId: householdIdColumn(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id),
    title: text("title").notNull(),
    createdAt: tstz("created_at").notNull(),
    archivedAt: tstz("archived_at"),
  },
  (t) => [
    index("conversation_household_id_idx").on(t.householdId),
    unique("conversation_household_id_id_key").on(t.householdId, t.id),
  ],
);

/** Append-only (AGT-8). */
export const chatMessage = pgTable(
  "chat_message",
  {
    id: uuid("id").primaryKey(),
    householdId: householdIdColumn(),
    conversationId: uuid("conversation_id").notNull(),
    role: chatRole("role").notNull(),
    content: jsonb("content").$type<Json>().notNull(),
    createdAt: tstz("created_at").notNull(),
  },
  (t) => [
    index("chat_message_household_id_idx").on(t.householdId),
    index("chat_message_conversation_id_idx").on(t.conversationId, t.createdAt),
    unique("chat_message_household_id_id_key").on(t.householdId, t.id),
    foreignKey({
      name: "chat_message_conversation_fk",
      columns: [t.householdId, t.conversationId],
      foreignColumns: [conversation.householdId, conversation.id],
    }),
  ],
);

export const changeSet = pgTable(
  "change_set",
  {
    id: uuid("id").primaryKey(),
    householdId: householdIdColumn(),
    actor: changeActor("actor").notNull(),
    actorUserId: uuid("actor_user_id").references(() => user.id),
    source: changeSource("source").notNull(),
    summary: text("summary").notNull(),
    forward: jsonb("forward").$type<Json>().notNull(),
    inverse: jsonb("inverse").$type<Json>().notNull(),
    appliedAt: tstz("applied_at").notNull(),
    undoneAt: tstz("undone_at"),
    undoneByChangeSetId: uuid("undone_by_change_set_id"),
  },
  (t) => [
    index("change_set_household_id_idx").on(t.householdId, t.appliedAt),
    unique("change_set_household_id_id_key").on(t.householdId, t.id),
    foreignKey({
      name: "change_set_undone_by_fk",
      columns: [t.householdId, t.undoneByChangeSetId],
      foreignColumns: [t.householdId, t.id],
    }),
  ],
);

export const proposal = pgTable(
  "proposal",
  {
    id: uuid("id").primaryKey(),
    householdId: householdIdColumn(),
    origin: proposalOrigin("origin").notNull(),
    conversationId: uuid("conversation_id"),
    messageId: uuid("message_id"),
    kind: text("kind").notNull(),
    payload: jsonb("payload").$type<Json>().notNull(),
    rationale: text("rationale").notNull(),
    evidence: jsonb("evidence").$type<Json>().notNull(),
    fingerprint: text("fingerprint").notNull(),
    status: proposalStatus("status").notNull(),
    decidedByUserId: uuid("decided_by_user_id").references(() => user.id),
    decidedAt: tstz("decided_at"),
    decisionNote: text("decision_note"),
    changeSetId: uuid("change_set_id"),
    expiresAt: tstz("expires_at").notNull(),
  },
  (t) => [
    index("proposal_household_id_idx").on(t.householdId, t.status),
    index("proposal_fingerprint_idx").on(t.householdId, t.fingerprint),
    foreignKey({
      name: "proposal_conversation_fk",
      columns: [t.householdId, t.conversationId],
      foreignColumns: [conversation.householdId, conversation.id],
    }),
    foreignKey({
      name: "proposal_message_fk",
      columns: [t.householdId, t.messageId],
      foreignColumns: [chatMessage.householdId, chatMessage.id],
    }),
    foreignKey({
      name: "proposal_change_set_fk",
      columns: [t.householdId, t.changeSetId],
      foreignColumns: [changeSet.householdId, changeSet.id],
    }),
  ],
);
