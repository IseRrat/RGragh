import assert from 'node:assert/strict';
import test from 'node:test';
import { layoutTreeNodes } from '../dist/tree-layout.js';

const seedNodes = [
  { id: 'root', parentId: null, order: 0, title: 'LLM Infra' },
  { id: 'mqa', parentId: 'root', order: 0, title: 'MQA' },
  { id: 'mqa-child', parentId: 'mqa', order: 0, title: 'GQA' },
  { id: 'orca', parentId: 'root', order: 1, title: 'Orca' },
  { id: 'orca-child', parentId: 'orca', order: 0, title: 'Orca child' },
];

const cardWidth = 196;
const cardHeight = 122;

function visibleDescendants(nodes, positions, id) {
  const found = [];
  const visit = (parentId) => {
    for (const child of nodes.filter((node) => node.parentId === parentId)) {
      if (!positions.has(child.id)) continue;
      found.push(child);
      visit(child.id);
    }
  };
  visit(id);
  return found;
}

function checkLayout(nodes, collapsed = new Set()) {
  const layout = layoutTreeNodes(nodes, collapsed);
  const { positions, subtreeBounds, canvasSize, originX } = layout;
  const visible = nodes.filter((node) => positions.has(node.id));
  assert.equal(originX, canvasSize.width / 2);
  for (let i = 0; i < visible.length; i++) {
    const a = positions.get(visible[i].id);
    for (let j = i + 1; j < visible.length; j++) {
      const b = positions.get(visible[j].id);
      const overlapX = a.x < b.x + cardWidth && b.x < a.x + cardWidth;
      const aHeight = visible[i].parentId === null ? 46 : cardHeight;
      const bHeight = visible[j].parentId === null ? 46 : cardHeight;
      const overlapY = a.y < b.y + bHeight && b.y < a.y + aHeight;
      assert(!(overlapX && overlapY), `${visible[i].id} overlaps ${visible[j].id}`);
    }
  }
  for (const parent of visible) {
    const children = nodes.filter((node) => node.parentId === parent.id && positions.has(node.id))
      .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
    if (children.length) {
      const first = positions.get(children[0].id).x + cardWidth / 2;
      const last = positions.get(children[children.length - 1].id).x + cardWidth / 2;
      assert.equal(positions.get(parent.id).x + cardWidth / 2, (first + last) / 2,
        `${parent.id} must be centered over all its children`);
    }
    for (let i = 1; i < children.length; i++) {
      const left = children[i - 1];
      const right = children[i];
      assert(subtreeBounds.get(left.id).right < subtreeBounds.get(right.id).left,
        `${left.id} and ${right.id} subtrees touch or overlap`);
      const rightMostLeft = Math.max(positions.get(left.id).x,
        ...visibleDescendants(nodes, positions, left.id).map((node) => positions.get(node.id).x));
      const leftMostRight = Math.min(positions.get(right.id).x,
        ...visibleDescendants(nodes, positions, right.id).map((node) => positions.get(node.id).x));
      assert(rightMostLeft + cardWidth < leftMostRight,
        `${left.id} must be left of the entire ${right.id} subtree`);
    }
  }
  return layout;
}

test('existing branches reserve their full subtree width', () => {
  const layout = checkLayout(seedNodes);
  const mqa = layout.positions.get('mqa');
  const orca = layout.positions.get('orca');
  assert(mqa.x < layout.subtreeBounds.get('orca').left);
  assert.equal(layout.originX, (mqa.x + orca.x + cardWidth) / 2);
});

test('adding and moving branches recomputes sibling space', () => {
  const nodes = structuredClone(seedNodes);
  nodes.push({ id: 'new-a', parentId: 'mqa', order: 1, title: 'A' });
  nodes.push({ id: 'new-b', parentId: 'new-a', order: 0, title: 'B' });
  nodes.push({ id: 'new-c', parentId: 'new-a', order: 1, title: 'C' });
  nodes.push({ id: 'new-d', parentId: 'root', order: 2, title: 'D' });
  const expanded = checkLayout(nodes);
  assert(expanded.positions.get('new-d').x > expanded.subtreeBounds.get('orca').right);

  nodes.find((node) => node.id === 'new-a').parentId = 'orca';
  checkLayout(nodes);
  const collapsed = checkLayout(nodes, new Set(['orca']));
  assert(!collapsed.positions.has('new-a'));
  assert.equal(collapsed.subtreeBounds.get('orca').width, cardWidth);
});
