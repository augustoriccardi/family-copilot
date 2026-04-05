-- CreateEnum
CREATE TYPE "MerchantId" AS ENUM ('DEVOTO', 'DISCO', 'GEANT');

-- CreateEnum
CREATE TYPE "ProposalType" AS ENUM ('EVENT', 'REMINDER', 'SHOPPING_ITEM', 'DOCUMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "ProposalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EDITED');

-- CreateTable
CREATE TABLE "merchant_connectors" (
    "id" TEXT NOT NULL,
    "household_id" TEXT NOT NULL,
    "merchant_id" "MerchantId" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "merchant_connectors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "action_proposals" (
    "id" TEXT NOT NULL,
    "household_id" TEXT NOT NULL,
    "member_id" TEXT,
    "type" "ProposalType" NOT NULL,
    "status" "ProposalStatus" NOT NULL DEFAULT 'PENDING',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "payload" JSONB NOT NULL,
    "source" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "notes" TEXT,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "action_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "merchant_connectors_household_id_merchant_id_key" ON "merchant_connectors"("household_id", "merchant_id");

-- CreateIndex
CREATE INDEX "action_proposals_household_id_status_idx" ON "action_proposals"("household_id", "status");

-- AddForeignKey
ALTER TABLE "merchant_connectors" ADD CONSTRAINT "merchant_connectors_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_proposals" ADD CONSTRAINT "action_proposals_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_proposals" ADD CONSTRAINT "action_proposals_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "family_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;
