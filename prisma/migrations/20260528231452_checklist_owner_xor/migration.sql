ALTER TABLE "Checklist"
ADD CONSTRAINT checklist_owner_xor CHECK (
  ("buildId" IS NOT NULL AND "boardId" IS NULL)
  OR ("buildId" IS NULL AND "boardId" IS NOT NULL)
);
