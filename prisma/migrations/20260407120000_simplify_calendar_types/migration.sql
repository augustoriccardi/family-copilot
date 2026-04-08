-- Migration: simplify MemberCalendarType to only PERSONAL and FAMILY_SHARED
-- PostgreSQL doesn't support DROP VALUE from an enum directly,
-- so we recreate the type swapping any now-removed values to PERSONAL as fallback.

-- 1. Update any rows using WORK, SCHOOL, or OTHER to PERSONAL
UPDATE "member_calendars"
SET "type" = 'PERSONAL'
WHERE "type" IN ('WORK', 'SCHOOL', 'OTHER');

-- 2. Create the new slim enum
CREATE TYPE "MemberCalendarType_new" AS ENUM ('PERSONAL', 'FAMILY_SHARED');

-- 3. Migrate the column to use the new type
ALTER TABLE "member_calendars"
  ALTER COLUMN "type" DROP DEFAULT;

ALTER TABLE "member_calendars"
  ALTER COLUMN "type" TYPE "MemberCalendarType_new"
  USING ("type"::text::"MemberCalendarType_new");

-- 4. Drop old type and rename new one
DROP TYPE "MemberCalendarType";
ALTER TYPE "MemberCalendarType_new" RENAME TO "MemberCalendarType";

-- 5. Re-apply the default
ALTER TABLE "member_calendars"
  ALTER COLUMN "type" SET DEFAULT 'PERSONAL';
