CREATE UNIQUE INDEX build_revision_label_ci
ON "Build" ("revisionId", lower("label"));
