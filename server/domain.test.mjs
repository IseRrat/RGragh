import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyMap, validateDocument } from '../dist/document-schema.js';
import { applyDomainAction, affectedWorkCount } from '../dist/domain-model.js';
import { taxonomyTags, visibleLineageNodeIds } from '../dist/taxonomy.js';

test('domain map starts with eight groups and 33 tags and survives validation', () => {
  const document = createEmptyMap();
  assert.equal(document.domainRoot.title, '大模型推理系统');
  assert.equal(document.domainRoot.english, 'LLM Inference Systems');
  assert.equal(document.taxonomy.length, 8);
  assert.equal(taxonomyTags(document.taxonomy).length, 33);
  assert.deepEqual(validateDocument(document).taxonomy, document.taxonomy);
});

test('renaming and recoloring a direction updates the tag and preserves its work', () => {
  let document = createEmptyMap();
  document.tagCatalog.push({ id: 'kv-reuse', name: '缓存复用', color: '#7458a7' });
  document.nodes.push({ id: 'work', parentId: 'root', order: 0, title: 'Example', tagId: 'kv-reuse' });
  document = applyDomainAction(document, { type: 'rename-tag', id: 'kv-reuse', name: '前缀缓存复用' });
  document = applyDomainAction(document, { type: 'color-tag', id: 'kv-reuse', color: '#395eae' });
  assert.equal(document.tagCatalog.find((item) => item.id === 'kv-reuse').name, '前缀缓存复用');
  assert.equal(document.tagCatalog.find((item) => item.id === 'kv-reuse').color, '#395eae');
  assert.equal(document.tagCatalog.find((item) => item.id === 'kv-allocation').color, '#395eae');
  assert.equal(document.nodes.find((item) => item.id === 'work').tagId, 'kv-reuse');
  assert.deepEqual([...visibleLineageNodeIds(document.nodes, 'kv', document.taxonomy)].sort(), ['root', 'work']);
});

test('deleting a direction clears linked tags while retaining works and papers', () => {
  let document = createEmptyMap();
  document.tagCatalog.push({ id: 'kv-reuse', name: '缓存复用', color: '#7458a7' });
  document.nodes.push({ id: 'work', parentId: 'root', order: 0, title: 'Example', tagId: 'kv-reuse' });
  document.papers.push({ id: 'paper', title: 'Example paper' });
  document.paperLinks.push({ nodeId: 'work', paperId: 'paper' });
  assert.equal(affectedWorkCount(document, 'group', 'kv'), 1);
  document = applyDomainAction(document, { type: 'delete-group', id: 'kv' });
  assert.equal(document.nodes.find((item) => item.id === 'work').tagId, null);
  assert.equal(document.papers.length, 1);
  assert.deepEqual(document.paperLinks, [{ nodeId: 'work', paperId: 'paper' }]);
  assert.equal(document.taxonomy.length, 7);
});

test('adding a direction creates a selectable tag with its group color', () => {
  let document = createEmptyMap();
  document = applyDomainAction(document, { type: 'add-group', newId: 'new-group', name: '新方向', english: 'New Direction', color: '#183e82' });
  document = applyDomainAction(document, { type: 'add-tag', groupId: 'new-group', newId: 'new-tag', name: '新细分方向', english: 'New Topic' });
  assert.equal(document.tagCatalog.find((tag) => tag.id === 'new-tag').color, '#183e82');
  assert.equal(document.taxonomy.find((group) => group.id === 'new-group').english, 'New Direction');
  assert.equal(document.taxonomy.find((group) => group.id === 'new-group').tags[0].english, 'New Topic');
  document = applyDomainAction(document, { type: 'english-tag', id: 'new-tag', english: 'Updated Topic' });
  assert.equal(document.taxonomy.find((group) => group.id === 'new-group').tags[0].english, 'Updated Topic');
});
