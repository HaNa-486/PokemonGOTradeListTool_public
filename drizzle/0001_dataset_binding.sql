CREATE TABLE `dataset_bindings` (
	`id` integer PRIMARY KEY NOT NULL,
	`dataset_id` text NOT NULL,
	`schema_version` integer NOT NULL,
	`version` text NOT NULL,
	`kind` text NOT NULL,
	`content_hash` text NOT NULL,
	CONSTRAINT "dataset_singleton" CHECK("dataset_bindings"."id" = 1),
	CONSTRAINT "dataset_schema" CHECK("dataset_bindings"."schema_version" = 1),
	CONSTRAINT "dataset_kind" CHECK("dataset_bindings"."kind" IN ('synthetic','external')),
	CONSTRAINT "dataset_hash" CHECK(length("dataset_bindings"."content_hash") = 64)
);

--> statement-breakpoint
CREATE TRIGGER dataset_binding_no_update BEFORE UPDATE ON dataset_bindings
BEGIN SELECT RAISE(ABORT, 'dataset_binding_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER dataset_binding_no_delete BEFORE DELETE ON dataset_bindings
BEGIN SELECT RAISE(ABORT, 'dataset_binding_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER dataset_binding_no_rebind BEFORE INSERT ON dataset_bindings
WHEN EXISTS(SELECT 1 FROM dataset_bindings)
BEGIN SELECT RAISE(ABORT, 'dataset_binding_immutable'); END;
