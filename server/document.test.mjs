import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDocument } from './document.mjs';
import { createEmptyMap } from '../dist/document-schema.js';

const root = { id: 'root', parentId: null, title: 'Root' };
test('new document starts with a single LLM Infra root', () => {
  const empty = createEmptyMap('custom-root');
  const saved = validateDocument(empty);
  assert.equal(saved.version, 3);
  assert.deepEqual(saved.nodes.map((node) => [node.id, node.parentId, node.title]), [['custom-root', null, 'LLM Infra']]);
  assert.equal(saved.nodes[0].dabbled, false);
  assert.deepEqual(saved.tagCatalog, []);
  assert.deepEqual(saved.papers, []);
});
test('saves a work, its time and description, and a colored tag', () => {
  const result = validateDocument({ nodes: [root, { id: 'child', parentId: 'root', title: 'Child', time: '2025.9', description: 'Intro', tagId: 'tag-a' }], tagCatalog: [{ id: 'tag-a', name: 'KV Cache', color: '#AABBCC' }] });
  assert.equal(result.nodes.length, 2);
  assert.deepEqual(result.nodes[1], { id: 'child', parentId: 'root', order: 0, title: 'Child', time: '2025.9', description: 'Intro', tagId: 'tag-a', dabbled: false });
  assert.deepEqual(result.tagCatalog, [{ id: 'tag-a', name: 'KV Cache', color: '#aabbcc' }]);
});
test('defaults legacy nodes to unexplored and preserves explored nodes', () => {
  const result = validateDocument({ nodes: [root,
    { id: 'legacy', parentId: 'root', title: 'Legacy' },
    { id: 'read', parentId: 'root', title: 'Read', dabbled: true },
  ] });
  assert.equal(result.nodes.find((node) => node.id === 'legacy').dabbled, false);
  assert.equal(result.nodes.find((node) => node.id === 'read').dabbled, true);
  assert.equal(validateDocument(result).nodes.find((node) => node.id === 'read').dabbled, true);
});
test('rejects cycles, duplicates, and missing parents', () => {
  assert.throws(() => validateDocument({ nodes: [root, { ...root }] }), /重复/);
  assert.throws(() => validateDocument({ nodes: [root, { id: 'child', parentId: 'missing', title: 'Child' }] }), /父节点/);
  assert.throws(() => validateDocument({ nodes: [root, { id: 'a', parentId: 'b', title: 'A' }, { id: 'b', parentId: 'a', title: 'B' }] }), /循环/);
});
test('migrates former fields and removes obsolete problem nodes', () => {
  const result = validateDocument({ nodes: [
    root,
    { id: 'orca', parentId: 'root', title: 'Orca', type: 'work', order: 0, year: '2022', summary: 'Legacy intro', tags: ['Serving'] },
    { id: 'question', parentId: 'orca', title: 'Question', type: 'problem', order: 0 },
    { id: 'work', parentId: 'question', title: 'Work', type: 'work', order: 0, year: '2025.9', summary: 'Work intro' },
  ] });
  assert.deepEqual(result.nodes.map((node) => node.id), ['root', 'orca', 'work']);
  assert.equal(result.nodes[2].parentId, 'orca');
  assert.equal(result.nodes[1].time, '2022');
  assert.equal(result.nodes[1].description, 'Legacy intro');
  assert.equal(result.nodes[2].time, '2025.9');
  assert.equal(result.tagCatalog[0].name, 'Serving');
  assert.equal(result.nodes[1].tagId, result.tagCatalog[0].id);
});
test('keeps one paper in the library with links to multiple tree nodes', () => {
  const document = validateDocument({ nodes: [root, { id: 'a', parentId: 'root', title: 'A' }, { id: 'b', parentId: 'root', title: 'B' }],
    papers: [{ id: 'paper-1', title: 'Example', year: '2025.9', summary: 'Intro', status: 'reading', hasPdf: true }],
    paperLinks: [{ nodeId: 'a', paperId: 'paper-1' }, { nodeId: 'b', paperId: 'paper-1' }, { nodeId: 'a', paperId: 'paper-1' }] });
  assert.equal(document.papers.length, 1);
  assert.equal(document.papers[0].year, '2025.9');
  assert.equal(document.papers[0].hasPdf, true);
  assert.deepEqual(document.paperLinks, [{ nodeId: 'a', paperId: 'paper-1' }, { nodeId: 'b', paperId: 'paper-1' }]);
});
