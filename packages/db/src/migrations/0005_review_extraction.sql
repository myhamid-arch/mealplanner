ALTER TABLE "review" ADD COLUMN "extracted_tags" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "review" ADD COLUMN "extracted_at" timestamp (3) with time zone;