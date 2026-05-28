CREATE UNIQUE INDEX revision_project_label_ci
ON "Revision" ("projectId", lower("label"));
