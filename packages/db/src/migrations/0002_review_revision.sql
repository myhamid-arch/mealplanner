CREATE TABLE "review_revision" (
	"id" uuid PRIMARY KEY NOT NULL,
	"household_id" uuid NOT NULL,
	"review_id" uuid NOT NULL,
	"rating" smallint,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"comment" text,
	"replaced_at" timestamp (3) with time zone NOT NULL,
	"edited_by_user_id" uuid NOT NULL,
	CONSTRAINT "review_revision_rating_range" CHECK ("review_revision"."rating" IS NULL OR "review_revision"."rating" BETWEEN 1 AND 5)
);
--> statement-breakpoint
ALTER TABLE "review_revision" ADD CONSTRAINT "review_revision_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_revision" ADD CONSTRAINT "review_revision_edited_by_user_id_user_id_fk" FOREIGN KEY ("edited_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_revision" ADD CONSTRAINT "review_revision_review_fk" FOREIGN KEY ("household_id","review_id") REFERENCES "public"."review"("household_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "review_revision_household_id_idx" ON "review_revision" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "review_revision_review_idx" ON "review_revision" USING btree ("household_id","review_id");