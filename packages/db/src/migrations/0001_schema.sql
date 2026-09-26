CREATE TYPE "public"."ai_generation_mode" AS ENUM('auto', 'ask', 'off');--> statement-breakpoint
CREATE TYPE "public"."ai_purpose" AS ENUM('recipe', 'insights', 'chat', 'comment_extraction');--> statement-breakpoint
CREATE TYPE "public"."appetite" AS ENUM('small', 'medium', 'large');--> statement-breakpoint
CREATE TYPE "public"."change_actor" AS ENUM('user', 'agent', 'system');--> statement-breakpoint
CREATE TYPE "public"."change_source" AS ENUM('ui', 'agent_apply', 'proposal_accept', 'learning');--> statement-breakpoint
CREATE TYPE "public"."chat_role" AS ENUM('user', 'assistant', 'tool', 'event');--> statement-breakpoint
CREATE TYPE "public"."component_role" AS ENUM('protein', 'carb', 'vegetable', 'sauce', 'fat', 'garnish', 'side', 'drink', 'adjuster');--> statement-breakpoint
CREATE TYPE "public"."cooking_liquid" AS ENUM('absorbed', 'retained');--> statement-breakpoint
CREATE TYPE "public"."day_kind" AS ENUM('default', 'training');--> statement-breakpoint
CREATE TYPE "public"."day_override_kind" AS ENUM('training', 'rest', 'absent_slot', 'extra_slot');--> statement-breakpoint
CREATE TYPE "public"."detail_level_value" AS ENUM('basic', 'detailed', 'expert');--> statement-breakpoint
CREATE TYPE "public"."dish_source" AS ENUM('seed', 'ai', 'admin');--> statement-breakpoint
CREATE TYPE "public"."dish_status" AS ENUM('draft', 'active', 'retired');--> statement-breakpoint
CREATE TYPE "public"."exclusion_kind" AS ENUM('ingredient', 'category', 'dietary_flag');--> statement-breakpoint
CREATE TYPE "public"."exclusion_reason" AS ENUM('allergy', 'religious', 'dislike', 'medical', 'other');--> statement-breakpoint
CREATE TYPE "public"."fit_status" AS ENUM('in_tolerance', 'flexible_miss', 'infeasible', 'untargeted');--> statement-breakpoint
CREATE TYPE "public"."frequency_entity_type" AS ENUM('dish', 'ingredient', 'cuisine', 'method');--> statement-breakpoint
CREATE TYPE "public"."household_role" AS ENUM('admin', 'member', 'kitchen');--> statement-breakpoint
CREATE TYPE "public"."household_user_status" AS ENUM('active', 'invited', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."ingredient_category" AS ENUM('poultry', 'red_meat', 'fish', 'seafood', 'egg', 'dairy', 'plant_protein', 'grain', 'starch', 'legume', 'vegetable', 'leafy_green', 'fruit', 'nut_seed', 'oil_fat', 'sauce_condiment', 'herb_spice', 'sweetener', 'bakery', 'beverage', 'supplement', 'other');--> statement-breakpoint
CREATE TYPE "public"."insight_frequency" AS ENUM('nightly', 'weekly', 'on_demand');--> statement-breakpoint
CREATE TYPE "public"."kg_edge_source" AS ENUM('seed', 'derived', 'learned', 'ai');--> statement-breakpoint
CREATE TYPE "public"."meal_override_kind" AS ENUM('split_member', 'make_individual');--> statement-breakpoint
CREATE TYPE "public"."nutrition_confidence" AS ENUM('high', 'medium', 'low');--> statement-breakpoint
CREATE TYPE "public"."plan_day_status" AS ENUM('draft', 'published', 'cooked');--> statement-breakpoint
CREATE TYPE "public"."plan_meal_status" AS ENUM('planned', 'cooked', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."portioning" AS ENUM('continuous', 'unit', 'fixed');--> statement-breakpoint
CREATE TYPE "public"."preference_entity_type" AS ENUM('dish', 'ingredient', 'cuisine', 'method', 'flavour_tag', 'component_role');--> statement-breakpoint
CREATE TYPE "public"."preference_hardness" AS ENUM('none', 'never', 'always_ok');--> statement-breakpoint
CREATE TYPE "public"."preference_source" AS ENUM('explicit', 'learned', 'proposal');--> statement-breakpoint
CREATE TYPE "public"."proposal_origin" AS ENUM('agent_chat', 'insights', 'rule');--> statement-breakpoint
CREATE TYPE "public"."proposal_status" AS ENUM('pending', 'accepted', 'rejected', 'expired', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."reaction_kind" AS ENUM('agree', 'disagree', 'helpful');--> statement-breakpoint
CREATE TYPE "public"."review_target_type" AS ENUM('dish', 'component', 'variant', 'ingredient', 'plan_meal', 'plate', 'plan_day', 'cuisine', 'method');--> statement-breakpoint
CREATE TYPE "public"."sex" AS ENUM('female', 'male', 'unspecified');--> statement-breakpoint
CREATE TYPE "public"."target_kind" AS ENUM('default', 'training');--> statement-breakpoint
CREATE TYPE "public"."tolerance_mode" AS ENUM('strict', 'flexible');--> statement-breakpoint
CREATE TYPE "public"."training_intensity" AS ENUM('light', 'moderate', 'hard');--> statement-breakpoint
CREATE TYPE "public"."unit_system" AS ENUM('metric');--> statement-breakpoint
CREATE TABLE "account" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp (3) with time zone,
	"refresh_token_expires_at" timestamp (3) with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "household" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"locale" text DEFAULT 'en-AE' NOT NULL,
	"timezone" text DEFAULT 'Asia/Dubai' NOT NULL,
	"unit_system" "unit_system" DEFAULT 'metric' NOT NULL,
	"country_code" text DEFAULT 'AE' NOT NULL,
	"region_note" text,
	"members_see_plates" boolean DEFAULT true NOT NULL,
	"agent_may_apply" boolean DEFAULT true NOT NULL,
	"require_totp_for_admins" boolean DEFAULT false NOT NULL,
	"kitchen_sees_names" boolean DEFAULT true NOT NULL,
	"members_review_for_siblings" boolean DEFAULT true NOT NULL,
	"insight_frequency" "insight_frequency" DEFAULT 'nightly' NOT NULL,
	"default_precision" "tolerance_mode" DEFAULT 'strict' NOT NULL,
	"sat_fat_default_pct" numeric(10, 3) DEFAULT 10 NOT NULL,
	"deletion_requested_at" timestamp (3) with time zone,
	"deletion_requested_by_user_id" uuid,
	"suspended_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "household_sat_fat_default_pct_range" CHECK ("household"."sat_fat_default_pct" > 0 AND "household"."sat_fat_default_pct" <= 100)
);
--> statement-breakpoint
CREATE TABLE "household_user" (
	"household_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "household_role" NOT NULL,
	"member_id" uuid,
	"status" "household_user_status" DEFAULT 'active' NOT NULL,
	"blocked_reason" text,
	"last_active_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "household_user_household_id_user_id_pk" PRIMARY KEY("household_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "invite" (
	"id" uuid PRIMARY KEY NOT NULL,
	"household_id" uuid NOT NULL,
	"code" varchar(10) NOT NULL,
	"role" "household_role" NOT NULL,
	"member_id" uuid,
	"expires_at" timestamp (3) with time zone NOT NULL,
	"used_at" timestamp (3) with time zone,
	"revoked_at" timestamp (3) with time zone,
	"created_by_user_id" uuid,
	"created_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "invite_code_unique" UNIQUE("code"),
	CONSTRAINT "invite_code_length" CHECK (char_length("invite"."code") = 10)
);
--> statement-breakpoint
CREATE TABLE "platform_operator" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"created_by_user_id" uuid
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp (3) with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "support_grant" (
	"id" uuid PRIMARY KEY NOT NULL,
	"household_id" uuid NOT NULL,
	"operator_user_id" uuid NOT NULL,
	"granted_by_user_id" uuid NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"expires_at" timestamp (3) with time zone NOT NULL,
	"revoked_at" timestamp (3) with time zone,
	CONSTRAINT "support_grant_expires_after_created" CHECK ("support_grant"."expires_at" > "support_grant"."created_at")
);
--> statement-breakpoint
CREATE TABLE "two_factor" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"secret" text NOT NULL,
	"backup_codes" text NOT NULL,
	"verified" boolean DEFAULT true NOT NULL,
	"failed_verification_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp (3) with time zone
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" "citext" NOT NULL,
	"name" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"two_factor_enabled" boolean DEFAULT false NOT NULL,
	"platform_blocked_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "user_notification_pref" (
	"user_id" uuid NOT NULL,
	"key" text NOT NULL,
	"enabled" boolean NOT NULL,
	CONSTRAINT "user_notification_pref_user_id_key_pk" PRIMARY KEY("user_id","key")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" uuid PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp (3) with time zone NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "day_override" (
	"id" uuid PRIMARY KEY NOT NULL,
	"household_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"date" date NOT NULL,
	"kind" "day_override_kind" NOT NULL,
	"slot_type_id" uuid,
	CONSTRAINT "day_override_member_date_kind_slot_key" UNIQUE NULLS NOT DISTINCT("member_id","date","kind","slot_type_id"),
	CONSTRAINT "day_override_slot_matches_kind" CHECK (("day_override"."kind" IN ('absent_slot', 'extra_slot')) = ("day_override"."slot_type_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "detail_level" (
	"id" uuid PRIMARY KEY NOT NULL,
	"household_id" uuid NOT NULL,
	"member_id" uuid,
	"section" text NOT NULL,
	"level" "detail_level_value" NOT NULL,
	CONSTRAINT "detail_level_household_member_section_key" UNIQUE NULLS NOT DISTINCT("household_id","member_id","section")
);
--> statement-breakpoint
CREATE TABLE "meal_distribution" (
	"household_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"day_kind" "day_kind" NOT NULL,
	"slot_type_id" uuid NOT NULL,
	"share" numeric(10, 3) NOT NULL,
	CONSTRAINT "meal_distribution_member_id_day_kind_slot_type_id_pk" PRIMARY KEY("member_id","day_kind","slot_type_id"),
	CONSTRAINT "meal_distribution_share_range" CHECK ("meal_distribution"."share" >= 0 AND "meal_distribution"."share" <= 1)
);
--> statement-breakpoint
CREATE TABLE "member" (
	"id" uuid PRIMARY KEY NOT NULL,
	"household_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"emoji_avatar" text,
	"color" text NOT NULL,
	"birth_year" integer,
	"sex" "sex",
	"is_targeted" boolean NOT NULL,
	"appetite" "appetite" DEFAULT 'medium' NOT NULL,
	"notes" text,
	"archived_at" timestamp (3) with time zone,
	CONSTRAINT "member_household_id_id_key" UNIQUE("household_id","id")
);
--> statement-breakpoint
CREATE TABLE "member_slot_schedule" (
	"household_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"slot_type_id" uuid NOT NULL,
	"weekday" smallint NOT NULL,
	"attends" boolean NOT NULL,
	CONSTRAINT "member_slot_schedule_member_id_slot_type_id_weekday_pk" PRIMARY KEY("member_id","slot_type_id","weekday"),
	CONSTRAINT "member_slot_schedule_weekday_range" CHECK ("member_slot_schedule"."weekday" BETWEEN 0 AND 6)
);
--> statement-breakpoint
CREATE TABLE "portion_bias" (
	"household_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"component_role" "component_role" NOT NULL,
	"bias" numeric(10, 3) DEFAULT 1 NOT NULL,
	CONSTRAINT "portion_bias_member_id_component_role_pk" PRIMARY KEY("member_id","component_role"),
	CONSTRAINT "portion_bias_bias_range" CHECK ("portion_bias"."bias" >= 0.6 AND "portion_bias"."bias" <= 1.6)
);
--> statement-breakpoint
CREATE TABLE "slot_target_override" (
	"household_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"day_kind" "day_kind" NOT NULL,
	"slot_type_id" uuid NOT NULL,
	"kcal" numeric(10, 3),
	"protein_g" numeric(10, 3),
	"carbs_g" numeric(10, 3),
	"fat_g" numeric(10, 3),
	CONSTRAINT "slot_target_override_member_id_day_kind_slot_type_id_pk" PRIMARY KEY("member_id","day_kind","slot_type_id")
);
--> statement-breakpoint
CREATE TABLE "slot_type" (
	"id" uuid PRIMARY KEY NOT NULL,
	"household_id" uuid NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"emoji" text NOT NULL,
	"sort_order" integer NOT NULL,
	"default_time" time NOT NULL,
	"is_shared" boolean NOT NULL,
	"is_packed" boolean NOT NULL,
	"reheat_available" boolean NOT NULL,
	"is_training_slot" boolean NOT NULL,
	"constraints_note" text,
	"active" boolean NOT NULL,
	CONSTRAINT "slot_type_household_id_id_key" UNIQUE("household_id","id"),
	CONSTRAINT "slot_type_household_id_key_key" UNIQUE("household_id","key")
);
--> statement-breakpoint
CREATE TABLE "target_profile" (
	"id" uuid PRIMARY KEY NOT NULL,
	"household_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"kind" "target_kind" NOT NULL,
	"kcal" numeric(10, 3) NOT NULL,
	"protein_g" numeric(10, 3) NOT NULL,
	"carbs_g" numeric(10, 3) NOT NULL,
	"fat_g" numeric(10, 3) NOT NULL,
	"sat_fat_max_g" numeric(10, 3),
	"soluble_fibre_min_g" numeric(10, 3),
	"fibre_min_g" numeric(10, 3),
	"sodium_max_mg" numeric(10, 3),
	CONSTRAINT "target_profile_member_id_kind_key" UNIQUE("member_id","kind"),
	CONSTRAINT "target_profile_non_negative" CHECK ("target_profile"."kcal" >= 0 AND "target_profile"."protein_g" >= 0 AND "target_profile"."carbs_g" >= 0 AND "target_profile"."fat_g" >= 0)
);
--> statement-breakpoint
CREATE TABLE "tolerance" (
	"member_id" uuid PRIMARY KEY NOT NULL,
	"household_id" uuid NOT NULL,
	"protein_g" numeric(10, 3) DEFAULT 5 NOT NULL,
	"carbs_g" numeric(10, 3) DEFAULT 5 NOT NULL,
	"fat_g" numeric(10, 3) DEFAULT 2 NOT NULL,
	"kcal" numeric(10, 3) DEFAULT 50 NOT NULL,
	"mode" "tolerance_mode" DEFAULT 'strict' NOT NULL,
	CONSTRAINT "tolerance_non_negative" CHECK ("tolerance"."protein_g" >= 0 AND "tolerance"."carbs_g" >= 0 AND "tolerance"."fat_g" >= 0 AND "tolerance"."kcal" >= 0)
);
--> statement-breakpoint
CREATE TABLE "training_schedule" (
	"household_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"weekday" smallint NOT NULL,
	"session_time" time,
	"intensity" "training_intensity",
	CONSTRAINT "training_schedule_member_id_weekday_pk" PRIMARY KEY("member_id","weekday"),
	CONSTRAINT "training_schedule_weekday_range" CHECK ("training_schedule"."weekday" BETWEEN 0 AND 6)
);
--> statement-breakpoint
CREATE TABLE "cuisine" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"flag_emoji" text,
	"parent_key" text,
	CONSTRAINT "cuisine_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "ingredient" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"category" "ingredient_category" NOT NULL,
	"kcal" numeric(10, 3) NOT NULL,
	"protein_g" numeric(10, 3) NOT NULL,
	"carbs_g" numeric(10, 3) NOT NULL,
	"fat_g" numeric(10, 3) NOT NULL,
	"sat_fat_g" numeric(10, 3) NOT NULL,
	"fibre_g" numeric(10, 3) NOT NULL,
	"soluble_fibre_g" numeric(10, 3),
	"sugar_g" numeric(10, 3),
	"sodium_mg" numeric(10, 3),
	"density_g_per_ml" numeric(10, 3),
	"unit_weight_g" numeric(10, 3),
	"unit_label" text,
	"edible_portion" numeric(10, 3) NOT NULL,
	"dietary_flags" text[] DEFAULT '{}'::text[] NOT NULL,
	"nutrition_source" text NOT NULL,
	"nutrition_confidence" "nutrition_confidence" NOT NULL,
	"locale_availability" jsonb NOT NULL,
	"created_by_household_id" uuid,
	"needs_review" boolean DEFAULT false NOT NULL,
	"verified_at" timestamp (3) with time zone,
	"verified_by_user_id" uuid,
	CONSTRAINT "ingredient_slug_unique" UNIQUE("slug"),
	CONSTRAINT "ingredient_edible_portion_range" CHECK ("ingredient"."edible_portion" > 0 AND "ingredient"."edible_portion" <= 1),
	CONSTRAINT "ingredient_nutrients_non_negative" CHECK ("ingredient"."kcal" >= 0 AND "ingredient"."protein_g" >= 0 AND "ingredient"."carbs_g" >= 0 AND "ingredient"."fat_g" >= 0 AND "ingredient"."sat_fat_g" >= 0 AND "ingredient"."fibre_g" >= 0)
);
--> statement-breakpoint
CREATE TABLE "method_yield" (
	"method_id" uuid NOT NULL,
	"ingredient_category" "ingredient_category" NOT NULL,
	"yield_factor" numeric(10, 3) NOT NULL,
	"fat_retention" numeric(10, 3) NOT NULL,
	"oil_absorption_g_per_100g_raw" numeric(10, 3) DEFAULT 0 NOT NULL,
	CONSTRAINT "method_yield_method_id_ingredient_category_pk" PRIMARY KEY("method_id","ingredient_category"),
	CONSTRAINT "method_yield_yield_factor_positive" CHECK ("method_yield"."yield_factor" > 0),
	CONSTRAINT "method_yield_fat_retention_range" CHECK ("method_yield"."fat_retention" >= 0 AND "method_yield"."fat_retention" <= 1),
	CONSTRAINT "method_yield_oil_absorption_non_negative" CHECK ("method_yield"."oil_absorption_g_per_100g_raw" >= 0)
);
--> statement-breakpoint
CREATE TABLE "preparation_method" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"description" text NOT NULL,
	"appeal_tags" text[] DEFAULT '{}'::text[] NOT NULL,
	CONSTRAINT "preparation_method_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "component" (
	"id" uuid PRIMARY KEY NOT NULL,
	"household_id" uuid,
	"dish_id" uuid NOT NULL,
	"name" text NOT NULL,
	"role" "component_role" NOT NULL,
	"portioning" "portioning" NOT NULL,
	"unit_label" text,
	"min_serving_g" numeric(10, 3) NOT NULL,
	"max_serving_g" numeric(10, 3) NOT NULL,
	"default_serving_g" numeric(10, 3) NOT NULL,
	"step_g" numeric(10, 3) DEFAULT 5 NOT NULL,
	"sort_order" integer NOT NULL,
	"required" boolean NOT NULL,
	CONSTRAINT "component_serving_bounds" CHECK ("component"."min_serving_g" >= 0 AND "component"."min_serving_g" <= "component"."default_serving_g" AND "component"."default_serving_g" <= "component"."max_serving_g"),
	CONSTRAINT "component_step_positive" CHECK ("component"."step_g" > 0)
);
--> statement-breakpoint
CREATE TABLE "dish" (
	"id" uuid PRIMARY KEY NOT NULL,
	"household_id" uuid,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text NOT NULL,
	"cuisine_id" uuid NOT NULL,
	"secondary_cuisine_id" uuid,
	"slot_keys" text[] DEFAULT '{}'::text[] NOT NULL,
	"flavour_tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"is_packable" boolean NOT NULL,
	"served_cold_ok" boolean NOT NULL,
	"source" "dish_source" NOT NULL,
	"status" "dish_status" NOT NULL,
	"ai_generation_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "dish_household_id_slug_key" UNIQUE NULLS NOT DISTINCT("household_id","slug"),
	CONSTRAINT "dish_version_positive" CHECK ("dish"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "dish_nutrition_cache" (
	"variant_id" uuid PRIMARY KEY NOT NULL,
	"household_id" uuid,
	"kcal" numeric(10, 3) NOT NULL,
	"protein" numeric(10, 3) NOT NULL,
	"carbs" numeric(10, 3) NOT NULL,
	"fat" numeric(10, 3) NOT NULL,
	"sat_fat" numeric(10, 3) NOT NULL,
	"fibre" numeric(10, 3) NOT NULL,
	"soluble_fibre" numeric(10, 3),
	"sugar" numeric(10, 3),
	"sodium" numeric(10, 3),
	"cooked_yield_g_per_batch" numeric(10, 3) NOT NULL,
	"computed_at" timestamp (3) with time zone NOT NULL,
	"engine_version" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "household_adjuster" (
	"household_id" uuid NOT NULL,
	"dish_id" uuid NOT NULL,
	"enabled" boolean NOT NULL,
	CONSTRAINT "household_adjuster_household_id_dish_id_pk" PRIMARY KEY("household_id","dish_id")
);
--> statement-breakpoint
CREATE TABLE "variant" (
	"id" uuid PRIMARY KEY NOT NULL,
	"household_id" uuid,
	"component_id" uuid NOT NULL,
	"method_id" uuid NOT NULL,
	"label" text NOT NULL,
	"is_default" boolean NOT NULL,
	"steps" jsonb NOT NULL,
	"cook_time_min" integer,
	"notes" text,
	"reference_batch_cooked_g" numeric(10, 3) DEFAULT 1000 NOT NULL,
	"needs_review" boolean DEFAULT false NOT NULL,
	CONSTRAINT "variant_reference_batch_positive" CHECK ("variant"."reference_batch_cooked_g" > 0)
);
--> statement-breakpoint
CREATE TABLE "variant_ingredient" (
	"id" uuid PRIMARY KEY NOT NULL,
	"household_id" uuid,
	"variant_id" uuid NOT NULL,
	"ingredient_id" uuid NOT NULL,
	"raw_g_per_batch" numeric(10, 3) NOT NULL,
	"role_note" text,
	"is_absorbed_oil" boolean NOT NULL,
	"cooking_liquid" "cooking_liquid",
	"yield_override" numeric(10, 3),
	CONSTRAINT "variant_ingredient_raw_positive" CHECK ("variant_ingredient"."raw_g_per_batch" > 0),
	CONSTRAINT "variant_ingredient_yield_override_positive" CHECK ("variant_ingredient"."yield_override" IS NULL OR "variant_ingredient"."yield_override" > 0)
);
--> statement-breakpoint
CREATE TABLE "cook_batch" (
	"id" uuid PRIMARY KEY NOT NULL,
	"household_id" uuid NOT NULL,
	"plan_meal_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"total_cooked_g" numeric(10, 3) NOT NULL,
	"raw_ingredients" jsonb NOT NULL,
	"servings" integer NOT NULL,
	CONSTRAINT "cook_batch_servings_positive" CHECK ("cook_batch"."servings" >= 1)
);
--> statement-breakpoint
CREATE TABLE "meal_override" (
	"id" uuid PRIMARY KEY NOT NULL,
	"household_id" uuid NOT NULL,
	"plan_date" date NOT NULL,
	"slot_type_id" uuid NOT NULL,
	"kind" "meal_override_kind" NOT NULL,
	"member_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "meal_override_household_date_slot_key" UNIQUE("household_id","plan_date","slot_type_id"),
	CONSTRAINT "meal_override_members_match_kind" CHECK (("meal_override"."kind" = 'split_member') = (cardinality("meal_override"."member_ids") > 0))
);
--> statement-breakpoint
CREATE TABLE "plan_day" (
	"id" uuid PRIMARY KEY NOT NULL,
	"household_id" uuid NOT NULL,
	"date" date NOT NULL,
	"status" "plan_day_status" NOT NULL,
	"weights_snapshot" jsonb NOT NULL,
	"generated_at" timestamp (3) with time zone NOT NULL,
	"generator_version" text NOT NULL,
	CONSTRAINT "plan_day_household_id_date_key" UNIQUE("household_id","date"),
	CONSTRAINT "plan_day_household_id_id_key" UNIQUE("household_id","id")
);
--> statement-breakpoint
CREATE TABLE "plan_meal" (
	"id" uuid PRIMARY KEY NOT NULL,
	"household_id" uuid NOT NULL,
	"plan_day_id" uuid NOT NULL,
	"slot_type_id" uuid NOT NULL,
	"dish_id" uuid NOT NULL,
	"dish_version" integer NOT NULL,
	"member_scope" text NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"score_breakdown" jsonb NOT NULL,
	"status" "plan_meal_status" NOT NULL,
	CONSTRAINT "plan_meal_household_id_id_key" UNIQUE("household_id","id"),
	CONSTRAINT "plan_meal_member_scope_format" CHECK ("plan_meal"."member_scope" = 'shared' OR "plan_meal"."member_scope" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
);
--> statement-breakpoint
CREATE TABLE "plate" (
	"id" uuid PRIMARY KEY NOT NULL,
	"household_id" uuid NOT NULL,
	"plan_meal_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"fit_status" "fit_status" NOT NULL,
	"target" jsonb NOT NULL,
	"actual" jsonb NOT NULL,
	"deviation" jsonb NOT NULL,
	CONSTRAINT "plate_household_id_id_key" UNIQUE("household_id","id"),
	CONSTRAINT "plate_plan_meal_id_member_id_key" UNIQUE("plan_meal_id","member_id")
);
--> statement-breakpoint
CREATE TABLE "plate_item" (
	"id" uuid PRIMARY KEY NOT NULL,
	"household_id" uuid NOT NULL,
	"plate_id" uuid NOT NULL,
	"component_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"cooked_g" numeric(10, 3) NOT NULL,
	"raw_equivalent" jsonb NOT NULL,
	CONSTRAINT "plate_item_cooked_g_non_negative" CHECK ("plate_item"."cooked_g" >= 0)
);
--> statement-breakpoint
CREATE TABLE "exclusion" (
	"id" uuid PRIMARY KEY NOT NULL,
	"household_id" uuid NOT NULL,
	"member_id" uuid,
	"kind" "exclusion_kind" NOT NULL,
	"key" text NOT NULL,
	"reason" "exclusion_reason" NOT NULL,
	"hard" boolean NOT NULL,
	CONSTRAINT "exclusion_household_member_kind_key_key" UNIQUE NULLS NOT DISTINCT("household_id","member_id","kind","key"),
	CONSTRAINT "exclusion_allergy_is_hard" CHECK ("exclusion"."reason" <> 'allergy' OR "exclusion"."hard")
);
--> statement-breakpoint
CREATE TABLE "frequency_rule" (
	"id" uuid PRIMARY KEY NOT NULL,
	"household_id" uuid NOT NULL,
	"member_id" uuid,
	"entity_type" "frequency_entity_type" NOT NULL,
	"entity_key" text NOT NULL,
	"min_gap_days" integer,
	"max_per_week" integer,
	"source" "preference_source" NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	CONSTRAINT "frequency_rule_household_member_entity_key" UNIQUE NULLS NOT DISTINCT("household_id","member_id","entity_type","entity_key"),
	CONSTRAINT "frequency_rule_has_limit" CHECK ("frequency_rule"."min_gap_days" IS NOT NULL OR "frequency_rule"."max_per_week" IS NOT NULL),
	CONSTRAINT "frequency_rule_limits_positive" CHECK (("frequency_rule"."min_gap_days" IS NULL OR "frequency_rule"."min_gap_days" >= 1) AND ("frequency_rule"."max_per_week" IS NULL OR "frequency_rule"."max_per_week" >= 0))
);
--> statement-breakpoint
CREATE TABLE "planning_weights" (
	"household_id" uuid PRIMARY KEY NOT NULL,
	"macro_precision" numeric(10, 3) DEFAULT 1 NOT NULL,
	"appeal" numeric(10, 3) DEFAULT 0.6 NOT NULL,
	"ingredient_economy" numeric(10, 3) DEFAULT 0.4 NOT NULL,
	"variety" numeric(10, 3) DEFAULT 0.3 NOT NULL,
	"fairness" numeric(10, 3) DEFAULT 0.5 NOT NULL,
	"ai_generation" "ai_generation_mode" DEFAULT 'auto' NOT NULL,
	"economy_window_days" integer DEFAULT 7 NOT NULL,
	"adjusters_enabled" boolean DEFAULT true NOT NULL,
	"max_variants_per_component" integer DEFAULT 3 NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "planning_weights_range" CHECK ("planning_weights"."macro_precision" BETWEEN 0 AND 1 AND "planning_weights"."appeal" BETWEEN 0 AND 1 AND "planning_weights"."ingredient_economy" BETWEEN 0 AND 1 AND "planning_weights"."variety" BETWEEN 0 AND 1 AND "planning_weights"."fairness" BETWEEN 0 AND 1),
	CONSTRAINT "planning_weights_window_positive" CHECK ("planning_weights"."economy_window_days" >= 1),
	CONSTRAINT "planning_weights_max_variants_positive" CHECK ("planning_weights"."max_variants_per_component" >= 1)
);
--> statement-breakpoint
CREATE TABLE "preference" (
	"id" uuid PRIMARY KEY NOT NULL,
	"household_id" uuid NOT NULL,
	"member_id" uuid,
	"entity_type" "preference_entity_type" NOT NULL,
	"entity_key" text NOT NULL,
	"score" numeric(10, 3) NOT NULL,
	"evidence_weight" numeric(10, 3) DEFAULT 0 NOT NULL,
	"source" "preference_source" NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"hard" "preference_hardness" DEFAULT 'none' NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "preference_household_member_entity_source_key" UNIQUE NULLS NOT DISTINCT("household_id","member_id","entity_type","entity_key","source"),
	CONSTRAINT "preference_score_range" CHECK ("preference"."score" >= -1 AND "preference"."score" <= 1),
	CONSTRAINT "preference_evidence_weight_non_negative" CHECK ("preference"."evidence_weight" >= 0)
);
--> statement-breakpoint
CREATE TABLE "review" (
	"id" uuid PRIMARY KEY NOT NULL,
	"household_id" uuid NOT NULL,
	"author_user_id" uuid NOT NULL,
	"on_behalf_of_member_id" uuid,
	"target_type" "review_target_type" NOT NULL,
	"target_id" text NOT NULL,
	"plan_meal_id" uuid,
	"rating" smallint,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"comment" text,
	"parent_review_id" uuid,
	"created_at" timestamp (3) with time zone NOT NULL,
	"edited_at" timestamp (3) with time zone,
	"processed_at" timestamp (3) with time zone,
	CONSTRAINT "review_household_id_id_key" UNIQUE("household_id","id"),
	CONSTRAINT "review_rating_range" CHECK ("review"."rating" IS NULL OR "review"."rating" BETWEEN 1 AND 5)
);
--> statement-breakpoint
CREATE TABLE "review_reaction" (
	"household_id" uuid NOT NULL,
	"review_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "reaction_kind" NOT NULL,
	CONSTRAINT "review_reaction_review_id_user_id_kind_pk" PRIMARY KEY("review_id","user_id","kind")
);
--> statement-breakpoint
CREATE TABLE "weight_preset" (
	"id" uuid PRIMARY KEY NOT NULL,
	"household_id" uuid NOT NULL,
	"name" text NOT NULL,
	"values" jsonb NOT NULL,
	"applies_to_weekdays" integer[],
	CONSTRAINT "weight_preset_household_id_name_key" UNIQUE("household_id","name")
);
--> statement-breakpoint
CREATE TABLE "change_set" (
	"id" uuid PRIMARY KEY NOT NULL,
	"household_id" uuid NOT NULL,
	"actor" "change_actor" NOT NULL,
	"actor_user_id" uuid,
	"source" "change_source" NOT NULL,
	"summary" text NOT NULL,
	"forward" jsonb NOT NULL,
	"inverse" jsonb NOT NULL,
	"applied_at" timestamp (3) with time zone NOT NULL,
	"undone_at" timestamp (3) with time zone,
	"undone_by_change_set_id" uuid,
	CONSTRAINT "change_set_household_id_id_key" UNIQUE("household_id","id")
);
--> statement-breakpoint
CREATE TABLE "chat_message" (
	"id" uuid PRIMARY KEY NOT NULL,
	"household_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" "chat_role" NOT NULL,
	"content" jsonb NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "chat_message_household_id_id_key" UNIQUE("household_id","id")
);
--> statement-breakpoint
CREATE TABLE "conversation" (
	"id" uuid PRIMARY KEY NOT NULL,
	"household_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"archived_at" timestamp (3) with time zone,
	CONSTRAINT "conversation_household_id_id_key" UNIQUE("household_id","id")
);
--> statement-breakpoint
CREATE TABLE "proposal" (
	"id" uuid PRIMARY KEY NOT NULL,
	"household_id" uuid NOT NULL,
	"origin" "proposal_origin" NOT NULL,
	"conversation_id" uuid,
	"message_id" uuid,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"rationale" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"fingerprint" text NOT NULL,
	"status" "proposal_status" NOT NULL,
	"decided_by_user_id" uuid,
	"decided_at" timestamp (3) with time zone,
	"decision_note" text,
	"change_set_id" uuid,
	"expires_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kg_edge" (
	"id" uuid PRIMARY KEY NOT NULL,
	"household_id" uuid,
	"src_id" uuid NOT NULL,
	"dst_id" uuid NOT NULL,
	"type" text NOT NULL,
	"weight" numeric(10, 3) NOT NULL,
	"props" jsonb NOT NULL,
	"source" "kg_edge_source" NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "kg_edge_household_src_dst_type_key" UNIQUE NULLS NOT DISTINCT("household_id","src_id","dst_id","type")
);
--> statement-breakpoint
CREATE TABLE "kg_node" (
	"id" uuid PRIMARY KEY NOT NULL,
	"household_id" uuid,
	"type" text NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"props" jsonb NOT NULL,
	CONSTRAINT "kg_node_household_type_key_key" UNIQUE NULLS NOT DISTINCT("household_id","type","key")
);
--> statement-breakpoint
CREATE TABLE "ai_generation" (
	"id" uuid PRIMARY KEY NOT NULL,
	"household_id" uuid NOT NULL,
	"purpose" "ai_purpose" NOT NULL,
	"model" text NOT NULL,
	"request_summary" jsonb NOT NULL,
	"response_raw" jsonb NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"cache_read_tokens" integer NOT NULL,
	"stop_reason" text NOT NULL,
	"validation_errors" jsonb,
	"created_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household" ADD CONSTRAINT "household_deletion_requested_by_user_id_user_id_fk" FOREIGN KEY ("deletion_requested_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_user" ADD CONSTRAINT "household_user_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_user" ADD CONSTRAINT "household_user_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_user" ADD CONSTRAINT "household_user_member_fk" FOREIGN KEY ("household_id","member_id") REFERENCES "public"."member"("household_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite" ADD CONSTRAINT "invite_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite" ADD CONSTRAINT "invite_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite" ADD CONSTRAINT "invite_member_fk" FOREIGN KEY ("household_id","member_id") REFERENCES "public"."member"("household_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_operator" ADD CONSTRAINT "platform_operator_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_operator" ADD CONSTRAINT "platform_operator_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_grant" ADD CONSTRAINT "support_grant_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_grant" ADD CONSTRAINT "support_grant_operator_user_id_platform_operator_user_id_fk" FOREIGN KEY ("operator_user_id") REFERENCES "public"."platform_operator"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_grant" ADD CONSTRAINT "support_grant_granted_by_user_id_user_id_fk" FOREIGN KEY ("granted_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "two_factor" ADD CONSTRAINT "two_factor_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_notification_pref" ADD CONSTRAINT "user_notification_pref_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "day_override" ADD CONSTRAINT "day_override_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "day_override" ADD CONSTRAINT "day_override_member_fk" FOREIGN KEY ("household_id","member_id") REFERENCES "public"."member"("household_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "day_override" ADD CONSTRAINT "day_override_slot_type_fk" FOREIGN KEY ("household_id","slot_type_id") REFERENCES "public"."slot_type"("household_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "detail_level" ADD CONSTRAINT "detail_level_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "detail_level" ADD CONSTRAINT "detail_level_member_fk" FOREIGN KEY ("household_id","member_id") REFERENCES "public"."member"("household_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_distribution" ADD CONSTRAINT "meal_distribution_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_distribution" ADD CONSTRAINT "meal_distribution_member_fk" FOREIGN KEY ("household_id","member_id") REFERENCES "public"."member"("household_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_distribution" ADD CONSTRAINT "meal_distribution_slot_type_fk" FOREIGN KEY ("household_id","slot_type_id") REFERENCES "public"."slot_type"("household_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_slot_schedule" ADD CONSTRAINT "member_slot_schedule_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_slot_schedule" ADD CONSTRAINT "member_slot_schedule_member_fk" FOREIGN KEY ("household_id","member_id") REFERENCES "public"."member"("household_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_slot_schedule" ADD CONSTRAINT "member_slot_schedule_slot_type_fk" FOREIGN KEY ("household_id","slot_type_id") REFERENCES "public"."slot_type"("household_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portion_bias" ADD CONSTRAINT "portion_bias_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portion_bias" ADD CONSTRAINT "portion_bias_member_fk" FOREIGN KEY ("household_id","member_id") REFERENCES "public"."member"("household_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slot_target_override" ADD CONSTRAINT "slot_target_override_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slot_target_override" ADD CONSTRAINT "slot_target_override_member_fk" FOREIGN KEY ("household_id","member_id") REFERENCES "public"."member"("household_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slot_target_override" ADD CONSTRAINT "slot_target_override_slot_type_fk" FOREIGN KEY ("household_id","slot_type_id") REFERENCES "public"."slot_type"("household_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slot_type" ADD CONSTRAINT "slot_type_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "target_profile" ADD CONSTRAINT "target_profile_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "target_profile" ADD CONSTRAINT "target_profile_member_fk" FOREIGN KEY ("household_id","member_id") REFERENCES "public"."member"("household_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tolerance" ADD CONSTRAINT "tolerance_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tolerance" ADD CONSTRAINT "tolerance_member_fk" FOREIGN KEY ("household_id","member_id") REFERENCES "public"."member"("household_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_schedule" ADD CONSTRAINT "training_schedule_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_schedule" ADD CONSTRAINT "training_schedule_member_fk" FOREIGN KEY ("household_id","member_id") REFERENCES "public"."member"("household_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingredient" ADD CONSTRAINT "ingredient_created_by_household_id_household_id_fk" FOREIGN KEY ("created_by_household_id") REFERENCES "public"."household"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingredient" ADD CONSTRAINT "ingredient_verified_by_user_id_user_id_fk" FOREIGN KEY ("verified_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "method_yield" ADD CONSTRAINT "method_yield_method_id_preparation_method_id_fk" FOREIGN KEY ("method_id") REFERENCES "public"."preparation_method"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "component" ADD CONSTRAINT "component_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "component" ADD CONSTRAINT "component_dish_id_dish_id_fk" FOREIGN KEY ("dish_id") REFERENCES "public"."dish"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dish" ADD CONSTRAINT "dish_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dish" ADD CONSTRAINT "dish_cuisine_id_cuisine_id_fk" FOREIGN KEY ("cuisine_id") REFERENCES "public"."cuisine"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dish" ADD CONSTRAINT "dish_secondary_cuisine_id_cuisine_id_fk" FOREIGN KEY ("secondary_cuisine_id") REFERENCES "public"."cuisine"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dish" ADD CONSTRAINT "dish_ai_generation_id_ai_generation_id_fk" FOREIGN KEY ("ai_generation_id") REFERENCES "public"."ai_generation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dish_nutrition_cache" ADD CONSTRAINT "dish_nutrition_cache_variant_id_variant_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."variant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dish_nutrition_cache" ADD CONSTRAINT "dish_nutrition_cache_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_adjuster" ADD CONSTRAINT "household_adjuster_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_adjuster" ADD CONSTRAINT "household_adjuster_dish_id_dish_id_fk" FOREIGN KEY ("dish_id") REFERENCES "public"."dish"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variant" ADD CONSTRAINT "variant_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variant" ADD CONSTRAINT "variant_component_id_component_id_fk" FOREIGN KEY ("component_id") REFERENCES "public"."component"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variant" ADD CONSTRAINT "variant_method_id_preparation_method_id_fk" FOREIGN KEY ("method_id") REFERENCES "public"."preparation_method"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variant_ingredient" ADD CONSTRAINT "variant_ingredient_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variant_ingredient" ADD CONSTRAINT "variant_ingredient_variant_id_variant_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."variant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variant_ingredient" ADD CONSTRAINT "variant_ingredient_ingredient_id_ingredient_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredient"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cook_batch" ADD CONSTRAINT "cook_batch_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cook_batch" ADD CONSTRAINT "cook_batch_variant_id_variant_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."variant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cook_batch" ADD CONSTRAINT "cook_batch_plan_meal_fk" FOREIGN KEY ("household_id","plan_meal_id") REFERENCES "public"."plan_meal"("household_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_override" ADD CONSTRAINT "meal_override_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_override" ADD CONSTRAINT "meal_override_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_override" ADD CONSTRAINT "meal_override_slot_type_fk" FOREIGN KEY ("household_id","slot_type_id") REFERENCES "public"."slot_type"("household_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_day" ADD CONSTRAINT "plan_day_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_meal" ADD CONSTRAINT "plan_meal_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_meal" ADD CONSTRAINT "plan_meal_dish_id_dish_id_fk" FOREIGN KEY ("dish_id") REFERENCES "public"."dish"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_meal" ADD CONSTRAINT "plan_meal_plan_day_fk" FOREIGN KEY ("household_id","plan_day_id") REFERENCES "public"."plan_day"("household_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_meal" ADD CONSTRAINT "plan_meal_slot_type_fk" FOREIGN KEY ("household_id","slot_type_id") REFERENCES "public"."slot_type"("household_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plate" ADD CONSTRAINT "plate_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plate" ADD CONSTRAINT "plate_plan_meal_fk" FOREIGN KEY ("household_id","plan_meal_id") REFERENCES "public"."plan_meal"("household_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plate" ADD CONSTRAINT "plate_member_fk" FOREIGN KEY ("household_id","member_id") REFERENCES "public"."member"("household_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plate_item" ADD CONSTRAINT "plate_item_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plate_item" ADD CONSTRAINT "plate_item_component_id_component_id_fk" FOREIGN KEY ("component_id") REFERENCES "public"."component"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plate_item" ADD CONSTRAINT "plate_item_variant_id_variant_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."variant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plate_item" ADD CONSTRAINT "plate_item_plate_fk" FOREIGN KEY ("household_id","plate_id") REFERENCES "public"."plate"("household_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exclusion" ADD CONSTRAINT "exclusion_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exclusion" ADD CONSTRAINT "exclusion_member_fk" FOREIGN KEY ("household_id","member_id") REFERENCES "public"."member"("household_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "frequency_rule" ADD CONSTRAINT "frequency_rule_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "frequency_rule" ADD CONSTRAINT "frequency_rule_member_fk" FOREIGN KEY ("household_id","member_id") REFERENCES "public"."member"("household_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planning_weights" ADD CONSTRAINT "planning_weights_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preference" ADD CONSTRAINT "preference_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preference" ADD CONSTRAINT "preference_member_fk" FOREIGN KEY ("household_id","member_id") REFERENCES "public"."member"("household_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review" ADD CONSTRAINT "review_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review" ADD CONSTRAINT "review_author_user_id_user_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review" ADD CONSTRAINT "review_on_behalf_of_member_fk" FOREIGN KEY ("household_id","on_behalf_of_member_id") REFERENCES "public"."member"("household_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review" ADD CONSTRAINT "review_plan_meal_fk" FOREIGN KEY ("household_id","plan_meal_id") REFERENCES "public"."plan_meal"("household_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review" ADD CONSTRAINT "review_parent_review_fk" FOREIGN KEY ("household_id","parent_review_id") REFERENCES "public"."review"("household_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_reaction" ADD CONSTRAINT "review_reaction_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_reaction" ADD CONSTRAINT "review_reaction_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_reaction" ADD CONSTRAINT "review_reaction_review_fk" FOREIGN KEY ("household_id","review_id") REFERENCES "public"."review"("household_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weight_preset" ADD CONSTRAINT "weight_preset_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_set" ADD CONSTRAINT "change_set_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_set" ADD CONSTRAINT "change_set_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_set" ADD CONSTRAINT "change_set_undone_by_fk" FOREIGN KEY ("household_id","undone_by_change_set_id") REFERENCES "public"."change_set"("household_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_message" ADD CONSTRAINT "chat_message_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_message" ADD CONSTRAINT "chat_message_conversation_fk" FOREIGN KEY ("household_id","conversation_id") REFERENCES "public"."conversation"("household_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal" ADD CONSTRAINT "proposal_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal" ADD CONSTRAINT "proposal_decided_by_user_id_user_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal" ADD CONSTRAINT "proposal_conversation_fk" FOREIGN KEY ("household_id","conversation_id") REFERENCES "public"."conversation"("household_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal" ADD CONSTRAINT "proposal_message_fk" FOREIGN KEY ("household_id","message_id") REFERENCES "public"."chat_message"("household_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal" ADD CONSTRAINT "proposal_change_set_fk" FOREIGN KEY ("household_id","change_set_id") REFERENCES "public"."change_set"("household_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kg_edge" ADD CONSTRAINT "kg_edge_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kg_edge" ADD CONSTRAINT "kg_edge_src_id_kg_node_id_fk" FOREIGN KEY ("src_id") REFERENCES "public"."kg_node"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kg_edge" ADD CONSTRAINT "kg_edge_dst_id_kg_node_id_fk" FOREIGN KEY ("dst_id") REFERENCES "public"."kg_node"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kg_node" ADD CONSTRAINT "kg_node_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_generation" ADD CONSTRAINT "ai_generation_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_id_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "household_user_household_id_idx" ON "household_user" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "household_user_user_id_idx" ON "household_user" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "invite_household_id_idx" ON "invite" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "support_grant_household_id_idx" ON "support_grant" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "two_factor_user_id_idx" ON "two_factor" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "two_factor_secret_idx" ON "two_factor" USING btree ("secret");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "day_override_household_id_idx" ON "day_override" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "detail_level_household_id_idx" ON "detail_level" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "meal_distribution_household_id_idx" ON "meal_distribution" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "member_household_id_idx" ON "member" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "member_slot_schedule_household_id_idx" ON "member_slot_schedule" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "portion_bias_household_id_idx" ON "portion_bias" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "slot_target_override_household_id_idx" ON "slot_target_override" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "slot_type_household_id_idx" ON "slot_type" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "target_profile_household_id_idx" ON "target_profile" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "tolerance_household_id_idx" ON "tolerance" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "training_schedule_household_id_idx" ON "training_schedule" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "ingredient_created_by_household_id_idx" ON "ingredient" USING btree ("created_by_household_id");--> statement-breakpoint
CREATE INDEX "component_household_id_idx" ON "component" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "component_dish_id_idx" ON "component" USING btree ("dish_id");--> statement-breakpoint
CREATE INDEX "dish_household_id_idx" ON "dish" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "dish_nutrition_cache_household_id_idx" ON "dish_nutrition_cache" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "household_adjuster_household_id_idx" ON "household_adjuster" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "variant_household_id_idx" ON "variant" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "variant_component_id_idx" ON "variant" USING btree ("component_id");--> statement-breakpoint
CREATE INDEX "variant_ingredient_household_id_idx" ON "variant_ingredient" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "variant_ingredient_variant_id_idx" ON "variant_ingredient" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX "cook_batch_household_id_idx" ON "cook_batch" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "cook_batch_plan_meal_id_idx" ON "cook_batch" USING btree ("plan_meal_id");--> statement-breakpoint
CREATE INDEX "meal_override_household_id_idx" ON "meal_override" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "plan_day_household_id_idx" ON "plan_day" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "plan_meal_household_id_idx" ON "plan_meal" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "plan_meal_plan_day_id_idx" ON "plan_meal" USING btree ("plan_day_id");--> statement-breakpoint
CREATE INDEX "plate_household_id_idx" ON "plate" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "plate_plan_meal_id_idx" ON "plate" USING btree ("plan_meal_id");--> statement-breakpoint
CREATE INDEX "plate_item_household_id_idx" ON "plate_item" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "plate_item_plate_id_idx" ON "plate_item" USING btree ("plate_id");--> statement-breakpoint
CREATE INDEX "exclusion_household_id_idx" ON "exclusion" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "frequency_rule_household_id_idx" ON "frequency_rule" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "preference_household_id_idx" ON "preference" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "review_household_id_idx" ON "review" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "review_target_idx" ON "review" USING btree ("household_id","target_type","target_id");--> statement-breakpoint
CREATE INDEX "review_reaction_household_id_idx" ON "review_reaction" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "weight_preset_household_id_idx" ON "weight_preset" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "change_set_household_id_idx" ON "change_set" USING btree ("household_id","applied_at");--> statement-breakpoint
CREATE INDEX "chat_message_household_id_idx" ON "chat_message" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "chat_message_conversation_id_idx" ON "chat_message" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "conversation_household_id_idx" ON "conversation" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "proposal_household_id_idx" ON "proposal" USING btree ("household_id","status");--> statement-breakpoint
CREATE INDEX "proposal_fingerprint_idx" ON "proposal" USING btree ("household_id","fingerprint");--> statement-breakpoint
CREATE INDEX "kg_edge_household_id_idx" ON "kg_edge" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "kg_edge_src_id_type_idx" ON "kg_edge" USING btree ("src_id","type");--> statement-breakpoint
CREATE INDEX "kg_edge_dst_id_type_idx" ON "kg_edge" USING btree ("dst_id","type");--> statement-breakpoint
CREATE INDEX "kg_node_household_id_idx" ON "kg_node" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "ai_generation_household_id_idx" ON "ai_generation" USING btree ("household_id","created_at");