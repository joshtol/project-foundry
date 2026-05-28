CREATE UNIQUE INDEX build_one_unfrozen_per_revision
ON "Build" ("revisionId")
WHERE "frozenAt" IS NULL;
