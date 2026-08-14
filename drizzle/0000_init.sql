CREATE TYPE "public"."actor_type" AS ENUM('admin', 'vendor', 'system');--> statement-breakpoint
CREATE TYPE "public"."file_kind" AS ENUM('artwork_front', 'artwork_back', 'artwork_combined', 'invoice');--> statement-breakpoint
CREATE TYPE "public"."office_type" AS ENUM('us_senate', 'governor', 'secretary_of_state', 'attorney_general', 'state_treasurer', 'insurance_commissioner', 'state_board_of_education', 'state_senate', 'state_house', 'county_party', 'municipal_county_office', 'other');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('submitted', 'content_review', 'legal_review', 'final_review', 'changes_requested', 'approved', 'denied');--> statement-breakpoint
CREATE TYPE "public"."vendor_role" AS ENUM('designer_consultant', 'print_shop', 'mail_house');--> statement-breakpoint
CREATE TABLE "admins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"is_superuser" boolean DEFAULT false NOT NULL,
	"must_change_password" boolean DEFAULT true NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admins_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"role" "vendor_role" NOT NULL,
	"org_name" text NOT NULL,
	"contact_name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"paid_by_kdp" boolean DEFAULT false NOT NULL,
	"paid_at" timestamp with time zone,
	"paid_marked_by" uuid,
	"is_primary" boolean DEFAULT false NOT NULL,
	CONSTRAINT "contacts_project_id_role_unique" UNIQUE("project_id","role")
);
--> statement-breakpoint
CREATE TABLE "deleted_projects" (
	"id" uuid PRIMARY KEY NOT NULL,
	"candidate_supported" text NOT NULL,
	"office" "office_type" NOT NULL,
	"mail_date" date NOT NULL,
	"final_status" "project_status" NOT NULL,
	"total_cost_cents" bigint NOT NULL,
	"deleted_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"project_id" uuid NOT NULL,
	"actor" "actor_type" NOT NULL,
	"actor_id" uuid,
	"event_type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" "file_kind" NOT NULL,
	"r2_key" text NOT NULL,
	"original_filename" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"width_px" integer,
	"height_px" integer,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "files_version_id_kind_unique" UNIQUE("version_id","kind")
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"candidate_supported" text NOT NULL,
	"description" text NOT NULL,
	"office" "office_type" NOT NULL,
	"district_detail" text,
	"piece_count" integer NOT NULL,
	"total_cost_cents" bigint NOT NULL,
	"post_office_location" text NOT NULL,
	"permit_number" text NOT NULL,
	"mail_date" date NOT NULL,
	"status" "project_status" DEFAULT 'submitted' NOT NULL,
	"status_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"changes_requested_from" "project_status",
	"current_version_id" uuid,
	"vendor_token_hash" text NOT NULL,
	"token_rotated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_piece_count_check" CHECK ("projects"."piece_count" > 0),
	CONSTRAINT "projects_total_cost_cents_check" CHECK ("projects"."total_cost_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stage_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"stage" "project_status" NOT NULL,
	"decision" text NOT NULL,
	"checklist" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"notes" text,
	"reviewer_id" uuid NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stage_reviews_version_id_stage_unique" UNIQUE("version_id","stage"),
	CONSTRAINT "stage_reviews_decision_check" CHECK ("stage_reviews"."decision" in ('advanced','changes_requested','denied'))
);
--> statement-breakpoint
CREATE TABLE "submission_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"vendor_note" text,
	CONSTRAINT "submission_versions_project_id_version_number_unique" UNIQUE("project_id","version_number")
);
--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_paid_marked_by_admins_id_fk" FOREIGN KEY ("paid_marked_by") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deleted_projects" ADD CONSTRAINT "deleted_projects_deleted_by_admins_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_version_id_submission_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."submission_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_current_version_id_submission_versions_id_fk" FOREIGN KEY ("current_version_id") REFERENCES "public"."submission_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_admin_id_admins_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_reviews" ADD CONSTRAINT "stage_reviews_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_reviews" ADD CONSTRAINT "stage_reviews_version_id_submission_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."submission_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_reviews" ADD CONSTRAINT "stage_reviews_reviewer_id_admins_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_versions" ADD CONSTRAINT "submission_versions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_events_project" ON "events" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_files_project" ON "files" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "idx_projects_status" ON "projects" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_projects_mail_date" ON "projects" USING btree ("mail_date");--> statement-breakpoint
CREATE INDEX "idx_sessions_admin" ON "sessions" USING btree ("admin_id");--> statement-breakpoint
CREATE INDEX "idx_reviews_project" ON "stage_reviews" USING btree ("project_id","decided_at");