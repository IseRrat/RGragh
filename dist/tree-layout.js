// Give every visible subtree its own horizontal interval before placing cards.
// This keeps an older sibling clear of every descendant in the next subtree.
export function layoutTreeNodes(nodes, collapsed = new Set(), options = {}) {
  const cardWidth = options.cardWidth ?? 196;
  const cardHeight = options.cardHeight ?? 122;
  const siblingGap = options.siblingGap ?? 28;
  const levelHeight = options.levelHeight ?? 220;
  const sidePadding = options.sidePadding ?? 50;
  const root = nodes.find((node) => node.parentId === null);
  const childrenByParent = new Map();
  for (const node of nodes) {
    if (node.parentId === null) continue;
    const siblings = childrenByParent.get(node.parentId) ?? [];
    siblings.push(node);
    childrenByParent.set(node.parentId, siblings);
  }
  for (const siblings of childrenByParent.values()) {
    siblings.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
  }

  const positions = new Map();
  const subtreeBounds = new Map();
  if (!root) return { positions, subtreeBounds, originX: 0, canvasSize: { width: 0, height: 0 } };

  function measure(node) {
    const children = collapsed.has(node.id) ? [] : childrenByParent.get(node.id) ?? [];
    const measuredChildren = children.map(measure);
    const childrenWidth = measuredChildren.reduce((sum, child) => sum + child.width, 0)
      + Math.max(0, measuredChildren.length - 1) * siblingGap;
    return { node, children: measuredChildren, width: Math.max(cardWidth, childrenWidth) };
  }

  function place(branch, left, depth) {
    const childrenWidth = branch.children.reduce((sum, child) => sum + child.width, 0)
      + Math.max(0, branch.children.length - 1) * siblingGap;
    let childLeft = left + (branch.width - childrenWidth) / 2;
    const childCenters = [];
    for (const child of branch.children) {
      childCenters.push(place(child, childLeft, depth + 1));
      childLeft += child.width + siblingGap;
    }
    const center = childCenters.length
      ? (childCenters[0] + childCenters[childCenters.length - 1]) / 2
      : left + branch.width / 2;
    positions.set(branch.node.id, {
      x: center - cardWidth / 2,
      y: depth === 0 ? 20 : 140 + (depth - 1) * levelHeight,
    });
    subtreeBounds.set(branch.node.id, { left, right: left + branch.width, width: branch.width });
    return center;
  }

  const tree = measure(root);
  const rootCenter = place(tree, 0, 0);
  const visible = [...positions.values()];
  const leftEdge = Math.min(...visible.map((position) => position.x));
  const rightEdge = Math.max(...visible.map((position) => position.x + cardWidth));
  const halfWidth = Math.max(rootCenter - leftEdge, rightEdge - rootCenter) + sidePadding;
  const horizontalShift = halfWidth - rootCenter;
  for (const position of visible) position.x += horizontalShift;
  for (const bounds of subtreeBounds.values()) {
    bounds.left += horizontalShift;
    bounds.right += horizontalShift;
  }
  return {
    positions,
    subtreeBounds,
    originX: halfWidth,
    canvasSize: {
      width: halfWidth * 2,
      height: Math.max(260, ...visible.map((position) => position.y + cardHeight + 60)),
    },
  };
}
