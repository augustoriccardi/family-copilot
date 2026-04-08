-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'DONE', 'FAILED');

-- CreateEnum
CREATE TYPE "WatchedSourceType" AS ENUM ('GMAIL_LABEL', 'WEBPAGE', 'RSS');

-- AlterTable
ALTER TABLE "action_proposals" ADD COLUMN     "calendar_event_id" TEXT,
ADD COLUMN     "source_file_url" TEXT;

-- CreateTable
CREATE TABLE "automation_outbox" (
    "id" TEXT NOT NULL,
    "household_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "source" TEXT NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "process_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),

    CONSTRAINT "automation_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "watched_sources" (
    "id" TEXT NOT NULL,
    "household_id" TEXT NOT NULL,
    "type" "WatchedSourceType" NOT NULL,
    "name" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "member_id" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "last_checked_at" TIMESTAMP(3),
    "last_item_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "watched_sources_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "automation_outbox_status_process_at_idx" ON "automation_outbox"("status", "process_at");

-- CreateIndex
CREATE INDEX "watched_sources_household_id_type_idx" ON "watched_sources"("household_id", "type");

-- AddForeignKey
ALTER TABLE "action_proposals" ADD CONSTRAINT "action_proposals_calendar_event_id_fkey" FOREIGN KEY ("calendar_event_id") REFERENCES "calendar_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_outbox" ADD CONSTRAINT "automation_outbox_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "watched_sources" ADD CONSTRAINT "watched_sources_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "watched_sources" ADD CONSTRAINT "watched_sources_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "family_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;
