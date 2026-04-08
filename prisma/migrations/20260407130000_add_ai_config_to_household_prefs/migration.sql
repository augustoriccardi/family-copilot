-- Add AI provider/model/apiKey config to household_preferences
ALTER TABLE "household_preferences"
  ADD COLUMN IF NOT EXISTS "ai_provider" TEXT,
  ADD COLUMN IF NOT EXISTS "ai_model" TEXT,
  ADD COLUMN IF NOT EXISTS "ai_api_key" TEXT;
