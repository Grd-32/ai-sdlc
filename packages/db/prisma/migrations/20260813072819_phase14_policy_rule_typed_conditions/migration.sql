/*
  Warnings:

  - You are about to drop the column `field` on the `PolicyRule` table. All the data in the column will be lost.
  - You are about to drop the column `metadata` on the `PolicyRule` table. All the data in the column will be lost.
  - You are about to drop the column `operator` on the `PolicyRule` table. All the data in the column will be lost.
  - You are about to drop the column `type` on the `PolicyRule` table. All the data in the column will be lost.
  - You are about to drop the column `value` on the `PolicyRule` table. All the data in the column will be lost.
  - Added the required column `action` to the `PolicyRule` table without a default value. This is not possible if the table is not empty.
  - Added the required column `name` to the `PolicyRule` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `PolicyRule` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "PolicyRule" DROP COLUMN "field",
DROP COLUMN "metadata",
DROP COLUMN "operator",
DROP COLUMN "type",
DROP COLUMN "value",
ADD COLUMN     "action" "PolicyAction" NOT NULL,
ADD COLUMN     "aiInvolved" BOOLEAN,
ADD COLUMN     "name" TEXT NOT NULL,
ADD COLUMN     "reason" TEXT,
ADD COLUMN     "repositoryCriticalityIn" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "requiredApprovals" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "riskAtLeast" INTEGER,
ADD COLUMN     "sensitiveAreas" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;
