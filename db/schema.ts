import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, primaryKey, index, check } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(), displayName: text('display_name').notNull(), createdAt: text('created_at').notNull(),
});
export const identities = sqliteTable('identities', {
  provider: text('provider').notNull(), subject: text('subject').notNull(), userId: text('user_id').notNull().references(() => users.id),
}, t => [primaryKey({ columns: [t.provider, t.subject] })]);
export const sessions = sqliteTable('sessions', {
  hash: text('hash').primaryKey(), userId: text('user_id').notNull().references(() => users.id), expiresAt: integer('expires_at').notNull(),
});
export const oauthFlows = sqliteTable('oauth_flows', {
  hash: text('hash').primaryKey(), verifier: text('verifier').notNull(), nonce: text('nonce').notNull(), expiresAt: integer('expires_at').notNull(),
});
// Plan items and consents are one versioned aggregate. Independently editable
// records have stable indexed rows. Quantities have one authoritative listing.
export const entities = sqliteTable('entities', {
  id: text('id').primaryKey(), kind: text('kind').notNull(), ownerId: text('owner_id').notNull().references(() => users.id),
  circleId: text('circle_id'), version: integer('version').notNull(), data: text('data').notNull(),
  createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, t => [index('entity_owner_kind').on(t.ownerId, t.kind, t.id), index('entity_circle_kind').on(t.circleId, t.kind, t.id),
  check('entity_version_positive', sql`${t.version} > 0`), check('entity_json_valid', sql`json_valid(${t.data})`)]);
export const shares = sqliteTable('shares', {
  entityId: text('entity_id').notNull().references(() => entities.id), circleId: text('circle_id').notNull().references(() => entities.id),
}, t => [primaryKey({ columns: [t.entityId, t.circleId] }), index('shares_circle').on(t.circleId, t.entityId)]);
export const epochs = sqliteTable('epochs', { id: integer('id').primaryKey(), version: integer('version').notNull() });
export const transactionGuards = sqliteTable('transaction_guards', {
  id: text('id').primaryKey(), ok: integer('ok').notNull(),
}, t => [check('transaction_precondition', sql`${t.ok} = 1`)]);
export const commands = sqliteTable('idempotency_records', {
  actor: text('actor').notNull().references(() => users.id), operation: text('operation').notNull(), key: text('key').notNull(),
  hash: text('hash').notNull(), result: text('result').notNull(), createdAt: text('created_at').notNull(),
}, t => [primaryKey({ columns: [t.actor, t.operation, t.key] })]);
export const audit = sqliteTable('audit_events', {
  id: text('id').primaryKey(), actor: text('actor').notNull().references(() => users.id), operation: text('operation').notNull(),
  entityId: text('entity_id'), ownerId: text('owner_id').notNull().references(() => users.id), data: text('data').notNull(), createdAt: text('created_at').notNull(),
}, t => [index('audit_owner_time').on(t.ownerId, t.createdAt)]);
export const rateLimits = sqliteTable('rate_limits', {
  key: text('key').primaryKey(), window: integer('window').notNull(), count: integer('count').notNull(),
});

// Immutable ledger identity; changing a data package requires a reviewed migration.
export const datasetBindings = sqliteTable('dataset_bindings', {
  id: integer('id').primaryKey(), datasetId: text('dataset_id').notNull(),
  schemaVersion: integer('schema_version').notNull(), version: text('version').notNull(),
  kind: text('kind').notNull(), contentHash: text('content_hash').notNull(),
}, t => [check('dataset_singleton', sql`${t.id} = 1`),
  check('dataset_schema', sql`${t.schemaVersion} = 1`),
  check('dataset_kind', sql`${t.kind} IN ('synthetic','external')`),
  check('dataset_hash', sql`length(${t.contentHash}) = 64`)]);
