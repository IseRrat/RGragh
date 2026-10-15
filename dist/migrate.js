// Preserve work nodes when importing maps from the former problem/work format.
export function removeProblemNodes(documentData) {
  const nodes = documentData.nodes;
  const root = nodes.find((node) => node.parentId === null);
  if (!root) return documentData;
  const children = new Map();
  for (const node of nodes) {
    if (node.parentId === null) continue;
    const siblings = children.get(node.parentId) || [];
    siblings.push(node);
    children.set(node.parentId, siblings);
  }
  for (const siblings of children.values()) siblings.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
  const result = [root];
  const counts = new Map();
  const seen = new Set([root.id]);
  function visit(parentId, visibleParentId) {
    for (const node of children.get(parentId) || []) {
      if (seen.has(node.id)) continue;
      seen.add(node.id);
      if (node.type === 'problem') { visit(node.id, visibleParentId); continue; }
      const order = counts.get(visibleParentId) || 0;
      counts.set(visibleParentId, order + 1);
      result.push({ ...node, parentId: visibleParentId, order });
      visit(node.id, node.id);
    }
  }
  visit(root.id, root.id);
  return { ...documentData, nodes: result };
}
