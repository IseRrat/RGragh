// Classification follows the principal optimization target. Tree edges still
// describe technical lineage and may cross these categories.
export const TAXONOMY = [
  { id: 'request', name: '请求调度', english: 'Request Scheduling', color: '#16838d', tags: [
    ['request-batching', '批处理策略', 'Batching Strategies'],
    ['request-slo', '延迟约束调度', 'SLO-aware Scheduling'],
    ['request-admission', '抢占与准入控制', 'Preemption & Admission Control'],
    ['request-workload', '负载感知调度', 'Workload-aware Scheduling'],
  ] },
  { id: 'kv', name: 'KV 缓存管理', english: 'KV Cache Management', color: '#7653b7', tags: [
    ['kv-allocation', '内存分配', 'Memory Allocation'],
    ['kv-reuse', '缓存复用', 'Cache Reuse'],
    ['kv-offloading', '驱逐与卸载', 'Cache Eviction & Offloading'],
    ['kv-compression', '缓存压缩', 'Cache Compression'],
    ['kv-prefetch', '缓存迁移与预取', 'Cache Migration & Prefetching'],
  ] },
  { id: 'acceleration', name: '推理加速', english: 'Inference Acceleration', color: '#c05d2f', tags: [
    ['accel-kernel', '算子优化', 'Attention & Kernel Optimization'],
    ['accel-speculative', '投机解码', 'Speculative Decoding'],
    ['accel-quantization', '量化加速', 'Quantization'],
    ['accel-codesign', '算法与系统协同优化', 'Algorithm-System Co-design'],
  ] },
  { id: 'distributed', name: '分布式推理', english: 'Distributed Serving', color: '#386ac4', tags: [
    ['dist-parallelism', '模型并行', 'Model Parallelism'],
    ['dist-pd', 'PD 分离', 'Prefill-Decode Disaggregation'],
    ['dist-communication', '通信优化', 'Communication Optimization'],
    ['dist-kv', '分布式 KV 缓存', 'Distributed KV Cache'],
  ] },
  { id: 'cluster', name: '集群调度与资源管理', english: 'Cluster Scheduling & Resource Management', color: '#3c8751', tags: [
    ['cluster-routing', '请求路由', 'Request Routing'],
    ['cluster-allocation', '资源分配', 'Resource Allocation'],
    ['cluster-autoscaling', '弹性扩缩容', 'Autoscaling'],
    ['cluster-multitenancy', '多租户管理', 'Multi-tenancy'],
  ] },
  { id: 'memory', name: '内存与 I/O 系统', english: 'Memory & I/O Systems', color: '#a07913', tags: [
    ['memory-hierarchy', '分层内存体系', 'Memory Hierarchy'],
    ['memory-movement', '数据搬运优化', 'Data Movement Optimization'],
    ['memory-network', '网络感知优化', 'Network-aware Optimization'],
    ['memory-disaggregation', '存储解耦', 'Storage Disaggregation'],
  ] },
  { id: 'model', name: '模型结构感知优化', english: 'Model-aware Serving', color: '#a64d86', tags: [
    ['model-moe', 'MoE 服务', 'MoE Serving'],
    ['model-long-context', '长上下文推理', 'Long-context Serving'],
    ['model-multimodal', '多模态推理', 'Multimodal Serving'],
    ['model-heterogeneous', '异构模型服务', 'Heterogeneous Model Serving'],
  ] },
  { id: 'agent', name: 'Agent 推理服务', english: 'Agentic LLM Serving', color: '#b9434f', tags: [
    ['agent-stateful', '有状态服务', 'Stateful Serving'],
    ['agent-workflow', 'Agent 工作流调度', 'Agent Workflow Scheduling'],
    ['agent-cache', 'Agent 缓存管理', 'Agent Cache Management'],
    ['agent-multi', '多 Agent 服务', 'Multi-agent Serving'],
  ] },
];

export const TAXONOMY_TAGS = TAXONOMY.flatMap((group) => group.tags.map(([id, name, english]) => ({ id, name, english, groupId: group.id, color: group.color })));
export const TAXONOMY_CATALOG = TAXONOMY_TAGS.map(({ id, name, color }) => ({ id, name, color }));
const tagById = new Map(TAXONOMY_TAGS.map((tag) => [tag.id, tag]));
const validId = (id) => typeof id === 'string' && /^[\w-]{1,80}$/.test(id);
const validColor = (color) => typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color);

export function normalizeTaxonomy(source = TAXONOMY) {
  if (!Array.isArray(source) || source.length > 24) throw new Error('一级方向数量不合法');
  const groupIds = new Set(), tagIds = new Set(), groupNames = new Set(), tagNames = new Set();
  const groups = source.map((raw) => {
    const id = raw?.id;
    const name = String(raw?.name || '').trim().slice(0, 60);
    const color = String(raw?.color || '').toLowerCase();
    if (!validId(id) || groupIds.has(id) || !name || groupNames.has(name.toLocaleLowerCase()) || !validColor(color)) throw new Error('一级方向名称、ID 或颜色不合法');
    groupIds.add(id); groupNames.add(name.toLocaleLowerCase());
    if (!Array.isArray(raw.tags)) throw new Error('二级方向列表不合法');
    const tags = raw.tags.map((item) => {
      const tag = Array.isArray(item) ? { id: item[0], name: item[1], english: item[2] } : item;
      const tagName = String(tag?.name || '').trim().slice(0, 60);
      if (!validId(tag?.id) || tagIds.has(tag.id) || !tagName || tagNames.has(tagName.toLocaleLowerCase())) throw new Error('二级方向名称或 ID 重复、缺失');
      tagIds.add(tag.id); tagNames.add(tagName.toLocaleLowerCase());
      return { id: tag.id, name: tagName, english: String(tag.english || '').slice(0, 100) };
    });
    return { id, name, english: String(raw.english || '').slice(0, 100), color, tags };
  });
  if (tagIds.size > 200) throw new Error('二级方向不能超过 200 个');
  return groups;
}

export function taxonomyTags(groups = TAXONOMY) {
  return groups.flatMap((group) => group.tags.map((item) => {
    const tag = Array.isArray(item) ? { id: item[0], name: item[1], english: item[2] } : item;
    return { ...tag, groupId: group.id, color: group.color };
  }));
}

export function catalogFromTaxonomy(groups) {
  return taxonomyTags(groups).map(({ id, name, color }) => ({ id, name, color }));
}

export const taxonomyTag = (id, groups = TAXONOMY) => groups === TAXONOMY
  ? tagById.get(id) || null
  : taxonomyTags(groups).find((tag) => tag.id === id) || null;

export function visibleLineageNodeIds(nodes, groupId, groups = TAXONOMY) {
  if (!groupId) return new Set(nodes.map((node) => node.id));
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const visible = new Set();
  for (const node of nodes) {
    if (taxonomyTag(node.tagId, groups)?.groupId !== groupId) continue;
    let cursor = node;
    while (cursor && !visible.has(cursor.id)) {
      visible.add(cursor.id);
      cursor = byId.get(cursor.parentId);
    }
  }
  for (const node of nodes) if (node.parentId === null) visible.add(node.id);
  return visible;
}
