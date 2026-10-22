CREATE FUNCTION "enforce_policy_revision_append_only"() RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF (to_jsonb(NEW) - 'policyId') IS DISTINCT FROM (to_jsonb(OLD) - 'policyId') THEN
            RAISE EXCEPTION 'PolicyRevision records are append-only'
                USING ERRCODE = '55000';
        END IF;

        IF NEW."policyId" IS DISTINCT FROM OLD."policyId"
            AND (NEW."policyId" IS NOT NULL OR pg_trigger_depth() <= 1) THEN
            RAISE EXCEPTION 'PolicyRevision records are append-only'
                USING ERRCODE = '55000';
        END IF;

        RETURN NEW;
    END IF;

    IF pg_trigger_depth() <= 1 THEN
        RAISE EXCEPTION 'PolicyRevision records are append-only'
            USING ERRCODE = '55000';
    END IF;

    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PolicyRevision_append_only_update"
BEFORE UPDATE ON "PolicyRevision"
FOR EACH ROW
EXECUTE FUNCTION "enforce_policy_revision_append_only"();

CREATE TRIGGER "PolicyRevision_append_only_delete"
BEFORE DELETE ON "PolicyRevision"
FOR EACH ROW
EXECUTE FUNCTION "enforce_policy_revision_append_only"();

CREATE FUNCTION "reject_policy_revision_truncate"() RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'PolicyRevision records are append-only'
        USING ERRCODE = '55000';
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PolicyRevision_append_only_truncate"
BEFORE TRUNCATE ON "PolicyRevision"
FOR EACH STATEMENT
EXECUTE FUNCTION "reject_policy_revision_truncate"();
