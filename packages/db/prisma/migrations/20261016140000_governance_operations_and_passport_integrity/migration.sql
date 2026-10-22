ALTER TABLE "RiskAcceptance"
    ADD COLUMN "expiredNotifiedAt" TIMESTAMP(3);

CREATE TABLE "NotificationDeliveryAttempt" (
    "id" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "latencyMs" INTEGER,
    "providerMessageId" TEXT,
    "errorCode" TEXT,
    CONSTRAINT "NotificationDeliveryAttempt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NotificationDeliveryAttempt_notificationId_attempt_key"
    ON "NotificationDeliveryAttempt"("notificationId", "attempt");
CREATE INDEX "NotificationDeliveryAttempt_notificationId_attemptedAt_idx"
    ON "NotificationDeliveryAttempt"("notificationId", "attemptedAt");
CREATE INDEX "NotificationDeliveryAttempt_status_attemptedAt_idx"
    ON "NotificationDeliveryAttempt"("status", "attemptedAt");

ALTER TABLE "NotificationDeliveryAttempt"
    ADD CONSTRAINT "NotificationDeliveryAttempt_notificationId_fkey"
    FOREIGN KEY ("notificationId") REFERENCES "Notification"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ChangePassportRevision" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "passportId" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "revision" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "evidenceSnapshot" JSONB,
    "previousHash" TEXT,
    "contentHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChangePassportRevision_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ChangePassportRevision_passportId_revision_key"
    ON "ChangePassportRevision"("passportId", "revision");
CREATE INDEX "ChangePassportRevision_organizationId_passportId_revision_idx"
    ON "ChangePassportRevision"("organizationId", "passportId", "revision");

ALTER TABLE "ChangePassportRevision"
    ADD CONSTRAINT "ChangePassportRevision_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChangePassportRevision"
    ADD CONSTRAINT "ChangePassportRevision_passportId_fkey"
    FOREIGN KEY ("passportId") REFERENCES "ChangePassport"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

CREATE FUNCTION "enforce_change_passport_revision_append_only"() RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF (to_jsonb(NEW) - 'passportId' - 'organizationId')
            IS DISTINCT FROM (to_jsonb(OLD) - 'passportId' - 'organizationId') THEN
            RAISE EXCEPTION 'ChangePassportRevision records are append-only'
                USING ERRCODE = '55000';
        END IF;

        IF (NEW."passportId" IS DISTINCT FROM OLD."passportId"
            OR NEW."organizationId" IS DISTINCT FROM OLD."organizationId")
            AND pg_trigger_depth() <= 1 THEN
            RAISE EXCEPTION 'ChangePassportRevision records are append-only'
                USING ERRCODE = '55000';
        END IF;

        RETURN NEW;
    END IF;

    IF pg_trigger_depth() <= 1 THEN
        RAISE EXCEPTION 'ChangePassportRevision records are append-only'
            USING ERRCODE = '55000';
    END IF;

    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ChangePassportRevision_append_only_update"
BEFORE UPDATE ON "ChangePassportRevision"
FOR EACH ROW
EXECUTE FUNCTION "enforce_change_passport_revision_append_only"();

CREATE TRIGGER "ChangePassportRevision_append_only_delete"
BEFORE DELETE ON "ChangePassportRevision"
FOR EACH ROW
EXECUTE FUNCTION "enforce_change_passport_revision_append_only"();

CREATE FUNCTION "reject_change_passport_revision_truncate"() RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'ChangePassportRevision records are append-only'
        USING ERRCODE = '55000';
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ChangePassportRevision_append_only_truncate"
BEFORE TRUNCATE ON "ChangePassportRevision"
FOR EACH STATEMENT
EXECUTE FUNCTION "reject_change_passport_revision_truncate"();
