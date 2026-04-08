-- AlterTable
ALTER TABLE "Thread" ADD COLUMN IF NOT EXISTS "user_id" TEXT;

-- AddForeignKey
ALTER TABLE "Thread" ADD CONSTRAINT "Thread_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
