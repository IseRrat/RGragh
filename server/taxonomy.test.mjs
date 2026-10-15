import test from 'node:test';
import assert from 'node:assert/strict';
import { TAXONOMY, TAXONOMY_CATALOG, TAXONOMY_TAGS, visibleLineageNodeIds } from '../dist/taxonomy.js';

test('the eight directions expose all 33 fixed tags with one color per direction', () => {
  assert.equal(TAXONOMY.length, 8);
  assert.equal(TAXONOMY_TAGS.length, 33);
  assert.equal(new Set(TAXONOMY_TAGS.map((tag) => tag.id)).size, 33);
  assert.equal(TAXONOMY_CATALOG.length, 33);
  for (const group of TAXONOMY) {
    assert.ok(group.tags.length >= 4);
    assert.ok(TAXONOMY_TAGS.filter((tag) => tag.groupId === group.id).every((tag) => tag.color === group.color));
  }
});

test('category filtering retains ancestor context without other branches', () => {
  const nodes = [
    { id: 'root', parentId: null },
    { id: 'parent', parentId: 'root', tagId: 'request-batching' },
    { id: 'match', parentId: 'parent', tagId: 'kv-reuse' },
    { id: 'other', parentId: 'root', tagId: 'accel-speculative' },
  ];
  assert.deepEqual(visibleLineageNodeIds(nodes, 'kv'), new Set(['root', 'parent', 'match']));
});
