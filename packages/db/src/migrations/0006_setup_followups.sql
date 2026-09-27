CREATE TYPE "public"."setup_followup_status" AS ENUM('answered', 'dismissed');--> statement-breakpoint
ALTER TYPE "public"."ai_purpose" ADD VALUE 'onboarding_parse';--> statement-breakpoint
CREATE TABLE "setup_followup" (
	"id" uuid PRIMARY KEY NOT NULL,
	"household_id" uuid NOT NULL,
	"key" text NOT NULL,
	"status" "setup_followup_status" NOT NULL,
	"choice" text,
	"change_set_id" uuid,
	"resolved_by_user_id" uuid,
	"resolved_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "setup_followup_household_key_key" UNIQUE("household_id","key"),
	CONSTRAINT "setup_followup_key_length" CHECK (char_length("setup_followup"."key") BETWEEN 1 AND 80),
	CONSTRAINT "setup_followup_choice" CHECK (("setup_followup"."status" = 'answered') = ("setup_followup"."choice" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "setup_followup" ADD CONSTRAINT "setup_followup_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setup_followup" ADD CONSTRAINT "setup_followup_change_set_id_change_set_id_fk" FOREIGN KEY ("change_set_id") REFERENCES "public"."change_set"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setup_followup" ADD CONSTRAINT "setup_followup_resolved_by_user_id_user_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "setup_followup_household_id_idx" ON "setup_followup" USING btree ("household_id");