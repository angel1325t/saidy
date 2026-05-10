import assert from 'node:assert/strict';
import test from 'node:test';
import { materialSchema } from './catalog.js';

test('material payload accepts an empty or short optional summary as null', () => {
  const parsed = materialSchema.safeParse({
    kind: 'physical_book',
    title: 'Clean Architecture',
    summary: 'short',
    topics: ['software'],
    keywords: ['software']
  });

  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal(parsed.data.summary, null);
  }
});

test('material payload keeps real summary text', () => {
  const parsed = materialSchema.safeParse({
    kind: 'physical_book',
    title: 'Clean Architecture',
    summary: 'A practical catalog summary.',
    topics: ['software'],
    keywords: ['software']
  });

  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal(parsed.data.summary, 'A practical catalog summary.');
  }
});
