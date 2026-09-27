ALTER TABLE "exclusion" DROP CONSTRAINT "exclusion_household_member_kind_key_key";--> statement-breakpoint
ALTER TABLE "exclusion" ADD COLUMN "slot_keys" text[];--> statement-breakpoint
ALTER TABLE "exclusion" ADD CONSTRAINT "exclusion_household_member_kind_key_scope_key" UNIQUE NULLS NOT DISTINCT("household_id","member_id","kind","key","slot_keys");--> statement-breakpoint
ALTER TABLE "exclusion" ADD CONSTRAINT "exclusion_allergy_unscoped" CHECK ("exclusion"."reason" <> 'allergy' OR "exclusion"."slot_keys" IS NULL);--> statement-breakpoint
ALTER TABLE "exclusion" ADD CONSTRAINT "exclusion_slot_keys_not_empty" CHECK ("exclusion"."slot_keys" IS NULL OR cardinality("exclusion"."slot_keys") > 0);