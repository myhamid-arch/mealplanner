CREATE TYPE "public"."job_status" AS ENUM('queued', 'running', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "job" (
	"id" uuid PRIMARY KEY NOT NULL,
	"household_id" uuid,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"error" jsonb,
	"created_by_user_id" uuid,
	"created_at" timestamp (3) with time zone NOT NULL,
	"started_at" timestamp (3) with time zone,
	"finished_at" timestamp (3) with time zone
);
--> statement-breakpoint
CREATE TABLE "job_event" (
	"job_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"household_id" uuid,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "job_event_job_id_seq_pk" PRIMARY KEY("job_id","seq")
);
--> statement-breakpoint
CREATE TABLE "support_access" (
	"id" uuid PRIMARY KEY NOT NULL,
	"household_id" uuid NOT NULL,
	"grant_id" uuid NOT NULL,
	"operator_user_id" uuid NOT NULL,
	"method" text NOT NULL,
	"path" text NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "household" ADD COLUMN "deletion_confirmed_at" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "household" ADD COLUMN "deletion_confirmed_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "job" ADD CONSTRAINT "job_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job" ADD CONSTRAINT "job_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_event" ADD CONSTRAINT "job_event_job_id_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."job"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_event" ADD CONSTRAINT "job_event_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_access" ADD CONSTRAINT "support_access_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_access" ADD CONSTRAINT "support_access_operator_user_id_platform_operator_user_id_fk" FOREIGN KEY ("operator_user_id") REFERENCES "public"."platform_operator"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "job_household_id_idx" ON "job" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "job_status_created_idx" ON "job" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "job_event_household_id_idx" ON "job_event" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "support_access_household_id_idx" ON "support_access" USING btree ("household_id");--> statement-breakpoint
ALTER TABLE "household" ADD CONSTRAINT "household_deletion_confirmed_by_user_id_user_id_fk" FOREIGN KEY ("deletion_confirmed_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- BLD-8 R-40: a job row may be deleted (the undo of `recipe.generate` / `recipe.revise`) only while
-- it is still `queued`. The worker claims a job with `UPDATE … SET status = 'running' WHERE id = $1
-- AND status = 'queued'`; the row lock makes the claim and the undo's delete serialise, and this
-- trigger refuses the delete once the claim has committed, so exactly one of them wins. A household
-- purge (R2-ADM-6) sets `mealplanner.purge = 'on'` for its transaction to delete finished jobs.
CREATE FUNCTION "job_delete_only_queued"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF OLD."status" <> 'queued' AND coalesce(current_setting('mealplanner.purge', true), '') <> 'on' THEN
		RAISE EXCEPTION 'job % is %: only a queued job can be withdrawn', OLD."id", OLD."status"
			USING ERRCODE = 'object_in_use';
	END IF;
	RETURN OLD;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "job_delete_only_queued" BEFORE DELETE ON "job" FOR EACH ROW EXECUTE FUNCTION "job_delete_only_queued"();--> statement-breakpoint
-- BLD-8 R-42: Better Auth writes non-UUID verification ids (reserveVerificationValue).
ALTER TABLE "verification" ALTER COLUMN "id" TYPE text;
