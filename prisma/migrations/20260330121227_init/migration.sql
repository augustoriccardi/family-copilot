-- AlterTable
ALTER TABLE "MCPServer" ADD COLUMN     "authTokens" JSONB,
ADD COLUMN     "clientInfo" JSONB,
ADD COLUMN     "codeVerifier" TEXT,
ADD COLUMN     "oauthStatus" TEXT DEFAULT 'UNKNOWN',
ADD COLUMN     "requiresAuth" BOOLEAN DEFAULT false;
