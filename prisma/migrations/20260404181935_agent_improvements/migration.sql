-- CreateEnum
CREATE TYPE "FamilyRole" AS ENUM ('MADRE', 'PADRE', 'HIJO', 'HIJA', 'ABUELO', 'ABUELA', 'OTRO');

-- CreateEnum
CREATE TYPE "ConstraintType" AS ENUM ('ALLERGY', 'DISLIKE', 'MEDICATION', 'SCHEDULE_RULE', 'DIET', 'OTHER');

-- CreateEnum
CREATE TYPE "RecipeSourceType" AS ENUM ('AUDIO', 'IMAGE', 'TEXT', 'LINK', 'MANUAL');

-- CreateEnum
CREATE TYPE "ShoppingListStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PURCHASED');

-- CreateEnum
CREATE TYPE "ShoppingListSource" AS ENUM ('MANUAL', 'MEAL_PLAN', 'RECIPE', 'AUTO');

-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('FAMILY', 'PERSONAL', 'MEDICAL', 'SCHOOL', 'ACTIVITY', 'WORK', 'OTHER');

-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('CONFIRMED', 'TENTATIVE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EventVisibility" AS ENUM ('FAMILY', 'PRIVATE', 'CUSTOM');

-- CreateEnum
CREATE TYPE "ParticipationRole" AS ENUM ('ORGANIZER', 'PARTICIPANT', 'RESPONSIBLE', 'OPTIONAL');

-- CreateEnum
CREATE TYPE "RsvpStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'MAYBE');

-- CreateEnum
CREATE TYPE "MemberCalendarType" AS ENUM ('PERSONAL', 'FAMILY_SHARED', 'WORK', 'SCHOOL', 'OTHER');

-- CreateEnum
CREATE TYPE "ReminderStatus" AS ENUM ('PENDING', 'SENT', 'DONE', 'DISMISSED');

-- CreateEnum
CREATE TYPE "ReminderChannel" AS ENUM ('WHATSAPP', 'EMAIL', 'PUSH', 'IN_APP');

-- CreateEnum
CREATE TYPE "MessageRole" AS ENUM ('USER', 'ASSISTANT', 'SYSTEM', 'TOOL');

-- AlterTable
ALTER TABLE "Thread" ADD COLUMN     "householdId" TEXT;

-- CreateTable
CREATE TABLE "message_metadata" (
    "id" TEXT NOT NULL,
    "thread_id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "agent_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_metadata_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "households" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "owner_user_id" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'America/Montevideo',
    "currency" TEXT NOT NULL DEFAULT 'UYU',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "households_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "family_members" (
    "id" TEXT NOT NULL,
    "household_id" TEXT NOT NULL,
    "linked_user_id" TEXT,
    "name" TEXT NOT NULL,
    "nickname" TEXT,
    "role" "FamilyRole" NOT NULL,
    "is_minor" BOOLEAN NOT NULL DEFAULT false,
    "birthdate" TIMESTAMP(3),
    "school_name" TEXT,
    "color" TEXT,
    "notes" TEXT,
    "whatsapp_phone" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "family_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "household_preferences" (
    "id" TEXT NOT NULL,
    "household_id" TEXT NOT NULL,
    "preferred_supermarket" TEXT,
    "weekly_budget" DECIMAL(10,2),
    "shopping_day" TEXT,
    "meal_style" TEXT,
    "diet_rules" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "household_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "family_constraints" (
    "id" TEXT NOT NULL,
    "household_id" TEXT NOT NULL,
    "member_id" TEXT,
    "type" "ConstraintType" NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "family_constraints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipes" (
    "id" TEXT NOT NULL,
    "household_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "source_type" "RecipeSourceType" NOT NULL,
    "source_url" TEXT,
    "description" TEXT,
    "servings" INTEGER,
    "prep_time_minutes" INTEGER,
    "cook_time_minutes" INTEGER,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "instructions" TEXT,
    "image_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recipes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipe_ingredients" (
    "id" TEXT NOT NULL,
    "recipe_id" TEXT NOT NULL,
    "ingredient_name" TEXT NOT NULL,
    "quantity" DECIMAL(10,2),
    "unit" TEXT,
    "optional" BOOLEAN NOT NULL DEFAULT false,
    "category" TEXT,

    CONSTRAINT "recipe_ingredients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pantry_items" (
    "id" TEXT NOT NULL,
    "household_id" TEXT NOT NULL,
    "item_name" TEXT NOT NULL,
    "quantity" DECIMAL(10,2),
    "unit" TEXT,
    "expiration_date" TIMESTAMP(3),
    "category" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pantry_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shopping_lists" (
    "id" TEXT NOT NULL,
    "household_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "ShoppingListStatus" NOT NULL DEFAULT 'DRAFT',
    "source_type" "ShoppingListSource" NOT NULL DEFAULT 'MANUAL',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shopping_lists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shopping_list_items" (
    "id" TEXT NOT NULL,
    "shopping_list_id" TEXT NOT NULL,
    "item_name" TEXT NOT NULL,
    "quantity" DECIMAL(10,2),
    "unit" TEXT,
    "category" TEXT,
    "source_recipe_id" TEXT,
    "is_purchased" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shopping_list_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_events" (
    "id" TEXT NOT NULL,
    "household_id" TEXT NOT NULL,
    "member_id" TEXT,
    "responsible_member_id" TEXT,
    "created_by_member_id" TEXT,
    "member_calendar_id" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "event_type" "EventType" NOT NULL DEFAULT 'FAMILY',
    "status" "EventStatus" NOT NULL DEFAULT 'CONFIRMED',
    "visibility" "EventVisibility" NOT NULL DEFAULT 'FAMILY',
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "all_day" BOOLEAN NOT NULL DEFAULT false,
    "location" TEXT,
    "is_recurring" BOOLEAN NOT NULL DEFAULT false,
    "recurrence_rule" TEXT,
    "notes" TEXT,
    "external_provider" TEXT,
    "external_event_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calendar_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_event_participants" (
    "event_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "role" "ParticipationRole" NOT NULL DEFAULT 'PARTICIPANT',
    "rsvp_status" "RsvpStatus" NOT NULL DEFAULT 'PENDING',
    "personal_event_id" TEXT,
    "notified" BOOLEAN NOT NULL DEFAULT false,
    "added_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "calendar_event_participants_pkey" PRIMARY KEY ("event_id","member_id")
);

-- CreateTable
CREATE TABLE "calendar_connections" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "member_id" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'google',
    "provider_email" TEXT NOT NULL,
    "access_token" TEXT NOT NULL,
    "refresh_token" TEXT,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calendar_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member_calendars" (
    "id" TEXT NOT NULL,
    "household_member_id" TEXT NOT NULL,
    "calendar_connection_id" TEXT,
    "type" "MemberCalendarType" NOT NULL DEFAULT 'PERSONAL',
    "google_calendar_id" TEXT NOT NULL,
    "display_name" TEXT,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "member_calendars_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "household_permissions" (
    "id" TEXT NOT NULL,
    "household_id" TEXT NOT NULL,
    "actor_member_id" TEXT NOT NULL,
    "target_member_id" TEXT NOT NULL,
    "can_view" BOOLEAN NOT NULL DEFAULT true,
    "can_create" BOOLEAN NOT NULL DEFAULT false,
    "can_edit" BOOLEAN NOT NULL DEFAULT false,
    "can_delete" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "household_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reminders" (
    "id" TEXT NOT NULL,
    "household_id" TEXT NOT NULL,
    "member_id" TEXT,
    "calendar_event_id" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "due_at" TIMESTAMP(3) NOT NULL,
    "recurrence_rule" TEXT,
    "status" "ReminderStatus" NOT NULL DEFAULT 'PENDING',
    "channel" "ReminderChannel" NOT NULL DEFAULT 'IN_APP',
    "minutes_before" INTEGER,
    "sent" BOOLEAN NOT NULL DEFAULT false,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reminders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_messages" (
    "id" TEXT NOT NULL,
    "household_id" TEXT NOT NULL,
    "thread_id" TEXT,
    "role" "MessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "intent" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "household_id" TEXT NOT NULL,
    "member_id" TEXT,
    "title" TEXT NOT NULL,
    "file_url" TEXT NOT NULL,
    "file_key" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "subject" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_chunks" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "chunk_index" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "message_metadata_thread_id_message_id_key" ON "message_metadata"("thread_id", "message_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "household_preferences_household_id_key" ON "household_preferences"("household_id");

-- CreateIndex
CREATE UNIQUE INDEX "household_permissions_household_id_actor_member_id_target_m_key" ON "household_permissions"("household_id", "actor_member_id", "target_member_id");

-- CreateIndex
CREATE INDEX "conversation_messages_household_id_created_at_idx" ON "conversation_messages"("household_id", "created_at");

-- CreateIndex
CREATE INDEX "conversation_messages_thread_id_idx" ON "conversation_messages"("thread_id");

-- CreateIndex
CREATE INDEX "documents_household_id_idx" ON "documents"("household_id");

-- CreateIndex
CREATE INDEX "documents_member_id_idx" ON "documents"("member_id");

-- CreateIndex
CREATE INDEX "document_chunks_document_id_idx" ON "document_chunks"("document_id");

-- AddForeignKey
ALTER TABLE "Thread" ADD CONSTRAINT "Thread_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_metadata" ADD CONSTRAINT "message_metadata_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "Thread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "households" ADD CONSTRAINT "households_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "family_members" ADD CONSTRAINT "family_members_linked_user_id_fkey" FOREIGN KEY ("linked_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "family_members" ADD CONSTRAINT "family_members_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "household_preferences" ADD CONSTRAINT "household_preferences_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "family_constraints" ADD CONSTRAINT "family_constraints_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "family_constraints" ADD CONSTRAINT "family_constraints_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "family_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_ingredients" ADD CONSTRAINT "recipe_ingredients_recipe_id_fkey" FOREIGN KEY ("recipe_id") REFERENCES "recipes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pantry_items" ADD CONSTRAINT "pantry_items_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shopping_lists" ADD CONSTRAINT "shopping_lists_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shopping_list_items" ADD CONSTRAINT "shopping_list_items_shopping_list_id_fkey" FOREIGN KEY ("shopping_list_id") REFERENCES "shopping_lists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shopping_list_items" ADD CONSTRAINT "shopping_list_items_source_recipe_id_fkey" FOREIGN KEY ("source_recipe_id") REFERENCES "recipes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "family_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_responsible_member_id_fkey" FOREIGN KEY ("responsible_member_id") REFERENCES "family_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_created_by_member_id_fkey" FOREIGN KEY ("created_by_member_id") REFERENCES "family_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_member_calendar_id_fkey" FOREIGN KEY ("member_calendar_id") REFERENCES "member_calendars"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_event_participants" ADD CONSTRAINT "calendar_event_participants_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "calendar_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_event_participants" ADD CONSTRAINT "calendar_event_participants_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "family_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_connections" ADD CONSTRAINT "calendar_connections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_connections" ADD CONSTRAINT "calendar_connections_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "family_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_calendars" ADD CONSTRAINT "member_calendars_household_member_id_fkey" FOREIGN KEY ("household_member_id") REFERENCES "family_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_calendars" ADD CONSTRAINT "member_calendars_calendar_connection_id_fkey" FOREIGN KEY ("calendar_connection_id") REFERENCES "calendar_connections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "household_permissions" ADD CONSTRAINT "household_permissions_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "household_permissions" ADD CONSTRAINT "household_permissions_actor_member_id_fkey" FOREIGN KEY ("actor_member_id") REFERENCES "family_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "household_permissions" ADD CONSTRAINT "household_permissions_target_member_id_fkey" FOREIGN KEY ("target_member_id") REFERENCES "family_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "family_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_calendar_event_id_fkey" FOREIGN KEY ("calendar_event_id") REFERENCES "calendar_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "Thread"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "family_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
