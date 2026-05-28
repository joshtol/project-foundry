CREATE UNIQUE INDEX board_build_serial_ci
ON "Board" ("buildId", lower("serial"));
