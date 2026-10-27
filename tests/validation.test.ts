import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { execute } from '../core/service';
import { validateEntitySchema } from '../core/backup-schemas';
import type { Unit } from '../core/model';

// Malformed input must fail before reading or writing business data.
const untouched = new Proxy({} as Unit, {
  get() { throw new Error('Validation reached business data'); },
});

test('oversized constrained batch fails before any ledger access', async () => {
  const item = { id: 'synthetic-listing', version: 1, quantity: 1 };
  await assert.rejects(execute(untouched, 'synthetic-actor', 'listing.batch', {
    items: Array.from({ length: 51 }, () => ({ ...item })),
  }), z.ZodError);
  // Invalid collection elements must still be rejected after the Zod upgrade.
  await assert.rejects(execute(untouched, 'synthetic-actor', 'listing.batch', {
    items: Array.from({ length: 5000 }, () => null),
  }), z.ZodError);
});

test('completion record values remain positive bounded integers and reject malformed containers', async () => {
  for (const lines of [{ item: '1' }, { item: 0 }, { item: -1 }, { item: 1.5 },
    { item: 1_000_001 }, { item: null }, [], null]) {
    await assert.rejects(execute(untouched, 'synthetic-actor', 'completion.report', {
      id: 'synthetic-plan', version: 1, lines,
    }), z.ZodError);
  }
});

test('backup records preserve arbitrary string IDs and enforce nested member and completion schemas', () => {
  const base = { id: 'synthetic-id', owner: 'synthetic-owner', version: 1,
    createdAt: '2026-10-28T00:00:00.000Z', updatedAt: '2026-10-28T00:00:00.000Z' };
  const circle = { ...base, kind: 'circle', name: 'Synthetic circle', fast: false,
    members: { 'member-with-dashes': { role: 'owner', status: 'active' } } };
  assert.doesNotThrow(() => validateEntitySchema(circle));
  for (const member of [{ role: 'superadmin', status: 'active' },
    { role: 'owner', status: 'active', privateExtra: true }, 'owner']) {
    assert.throws(() => validateEntitySchema({ ...circle, members: { member } }), z.ZodError);
  }
  const completion = { ...base, kind: 'completion', plan: 'synthetic-plan',
    lines: { 'item-with-dashes': 2 }, consents: [], voidConsents: [], fast: false,
    status: 'pending', revision: 1 };
  assert.doesNotThrow(() => validateEntitySchema(completion));
  assert.throws(() => validateEntitySchema({ ...completion, lines: { item: '2' } }), z.ZodError);
});
