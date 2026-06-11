// src/lib/graphrag/corpus.ts
// Resolves a knowledge graph into its retrieval corpus: the set of search
// docs ("m:" messages, "r:" reflections, "g:" node label+notes) covered by
// the graph's nodes, plus the traversal facts retrieval needs — BFS
// distance from the root, the label path to each node, and which node owns
// which doc. buildCorpus is pure (unit-tested); resolveCorpus is the Dexie
// loader that feeds it only the referenced chats.

import {
  collectSubtreeIds, db,
  type Chat, type GraphEdge, type GraphNode, type KnowledgeGraph,
  type Message, type Node as DbNode, type Reflection,
} from "../db";
import { docId } from "../search/docs";
import { displayTitle, type SourceResolvers } from "../graphFlow";

export interface GraphCorpus {
  graphId:         string;
  rootGraphNodeId: string;
  /** Every search-doc id this graph's nodes cover. */
  docIds: Set<string>;
  /** docId → owning graph node. Overlaps resolve nearest-to-root. */
  docToGraphNode: Map<string, string>;
  /** graphNodeId → BFS hops from the root (disconnected = maxFinite + 2). */
  distFromRoot: Map<string, number>;
  /** graphNodeId → display labels root → … → node ([label] when disconnected). */
  pathLabels: Map<string, string[]>;
  /** graphNodeId → BFS parent (null for the root and disconnected nodes). */
  parentByNode: Map<string, string | null>;
  nodesById: Map<string, GraphNode>;
  edges: GraphEdge[];
}

export interface CorpusSourceData {
  graph:       KnowledgeGraph;
  graphNodes:  GraphNode[];
  graphEdges:  GraphEdge[];
  /** Only the chats referenced by attachments (dock chats pre-filtered). */
  chats:       Chat[];
  chatNodes:   DbNode[];
  messages:    Message[];
  reflections: Reflection[];
}

export function buildCorpus(data: CorpusSourceData): GraphCorpus {
  const { graph, graphNodes, graphEdges } = data;
  const nodesById = new Map(graphNodes.map(n => [n._id, n]));
  const rootId = graph.rootNodeId;

  const chatById = new Map(data.chats.map(c => [c._id, c]));
  const chatNodeById = new Map(data.chatNodes.map(n => [n._id, n]));
  const reflById = new Map(data.reflections.map(r => [r._id, r]));
  const resolvers: SourceResolvers = {
    chatTitle: id => chatById.get(id)?.title,
    nodeInfo: id => {
      const n = chatNodeById.get(id);
      if (!n) return undefined;
      return {
        label:     n.label,
        chatId:    n.chatId,
        chatTitle: chatById.get(n.chatId)?.title ?? "?",
        isRoot:    n.parentId === null,
      };
    },
    reflectionTitle: id => reflById.get(id)?.title,
  };

  // ── BFS from the root over the undirected edges ────────────────────
  const adj = new Map<string, string[]>();
  const link = (a: string, b: string): void => {
    if (!nodesById.has(a) || !nodesById.has(b)) return;
    const arr = adj.get(a) ?? [];
    arr.push(b);
    adj.set(a, arr);
  };
  for (const e of graphEdges) {
    link(e.source, e.target);
    link(e.target, e.source);
  }

  const distFromRoot = new Map<string, number>();
  const parentByNode = new Map<string, string | null>();
  if (nodesById.has(rootId)) {
    distFromRoot.set(rootId, 0);
    parentByNode.set(rootId, null);
    const queue = [rootId];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      const d = distFromRoot.get(cur)!;
      for (const nb of adj.get(cur) ?? []) {
        if (distFromRoot.has(nb)) continue;
        distFromRoot.set(nb, d + 1);
        parentByNode.set(nb, cur);
        queue.push(nb);
      }
    }
  }
  const maxFinite = Math.max(0, ...distFromRoot.values());
  for (const n of graphNodes) {
    if (!distFromRoot.has(n._id)) {
      distFromRoot.set(n._id, maxFinite + 2);
      parentByNode.set(n._id, null);
    }
  }

  // Label paths: walk BFS parents (disconnected nodes stand alone).
  const titleOf = (id: string): string => {
    const n = nodesById.get(id);
    return n ? displayTitle(n, resolvers).title : "?";
  };
  const pathLabels = new Map<string, string[]>();
  for (const n of graphNodes) {
    const labels: string[] = [];
    let cur: string | null = n._id;
    while (cur !== null) {
      labels.unshift(titleOf(cur));
      cur = parentByNode.get(cur) ?? null;
    }
    pathLabels.set(n._id, labels);
  }

  // ── attachment → doc expansion, nearest-to-root owner wins ────────
  const messagesByChat = new Map<string, Message[]>();
  const messagesByNode = new Map<string, Message[]>();
  for (const m of data.messages) {
    const byChat = messagesByChat.get(m.chatId) ?? [];
    byChat.push(m);
    messagesByChat.set(m.chatId, byChat);
    const byNode = messagesByNode.get(m.nodeId) ?? [];
    byNode.push(m);
    messagesByNode.set(m.nodeId, byNode);
  }
  const chatNodesByChat = new Map<string, DbNode[]>();
  for (const n of data.chatNodes) {
    const arr = chatNodesByChat.get(n.chatId) ?? [];
    arr.push(n);
    chatNodesByChat.set(n.chatId, arr);
  }

  const docIds = new Set<string>();
  const docToGraphNode = new Map<string, string>();
  const claim = (id: string, owner: string): void => {
    docIds.add(id);
    if (!docToGraphNode.has(id)) docToGraphNode.set(id, owner);
  };

  const ordered = [...graphNodes].sort((a, b) =>
    (distFromRoot.get(a._id)! - distFromRoot.get(b._id)!) ||
    (a.createdAt - b.createdAt));

  for (const n of ordered) {
    // The node's own words are always part of the corpus.
    if (n.label.trim() || n.notes.trim()) {
      claim(docId("graphNode", n._id), n._id);
    }
    const a = n.attachment;
    if (!a) continue;
    if (a.type === "chat") {
      for (const m of messagesByChat.get(a.targetId) ?? []) {
        claim(docId("message", m._id), n._id);
      }
    } else if (a.type === "node") {
      const target = chatNodeById.get(a.targetId);
      if (!target) continue;   // stale — contributes nothing
      if (a.scope === "single") {
        for (const m of messagesByNode.get(a.targetId) ?? []) {
          claim(docId("message", m._id), n._id);
        }
      } else {
        const subtree = collectSubtreeIds(chatNodesByChat.get(target.chatId) ?? [], a.targetId);
        for (const nodeId of subtree) {
          for (const m of messagesByNode.get(nodeId) ?? []) {
            claim(docId("message", m._id), n._id);
          }
        }
      }
    } else if (reflById.has(a.targetId)) {
      claim(docId("reflection", a.targetId), n._id);
    }
  }

  return {
    graphId: graph._id,
    rootGraphNodeId: rootId,
    docIds, docToGraphNode, distFromRoot, pathLabels, parentByNode,
    nodesById,
    edges: graphEdges,
  };
}

/** Load exactly what buildCorpus needs from Dexie: the graph, its nodes +
 *  edges, and ONLY the chats/branches/reflections its attachments touch. */
export async function resolveCorpus(graphId: string): Promise<GraphCorpus | null> {
  const graph = await db.graphs.get(graphId);
  if (!graph) return null;

  const [graphNodes, graphEdges] = await Promise.all([
    db.graphNodes.where("graphId").equals(graphId).toArray(),
    db.graphEdges.where("graphId").equals(graphId).toArray(),
  ]);

  const chatIds = new Set<string>();
  const nodeTargets: string[] = [];
  const reflTargets: string[] = [];
  for (const n of graphNodes) {
    const a = n.attachment;
    if (!a) continue;
    if (a.type === "chat") chatIds.add(a.targetId);
    else if (a.type === "node") nodeTargets.push(a.targetId);
    else reflTargets.push(a.targetId);
  }
  const targetNodes = (await db.nodes.bulkGet(nodeTargets)).filter(Boolean) as DbNode[];
  for (const tn of targetNodes) chatIds.add(tn.chatId);

  const chatIdArr = [...chatIds];
  const [chatsRaw, chatNodes, messages, reflectionsRaw] = await Promise.all([
    db.chats.bulkGet(chatIdArr),
    chatIdArr.length > 0 ? db.nodes.where("chatId").anyOf(chatIdArr).toArray() : Promise.resolve([] as DbNode[]),
    chatIdArr.length > 0 ? db.messages.where("chatId").anyOf(chatIdArr).toArray() : Promise.resolve([] as Message[]),
    db.reflections.bulkGet(reflTargets),
  ]);

  // Dock chats can't normally be attached, but a graph must NEVER feed on
  // its own answers — filter defensively.
  const chats = (chatsRaw.filter(Boolean) as Chat[]).filter(c => !c.graphId);
  const allowedChatIds = new Set(chats.map(c => c._id));

  return buildCorpus({
    graph, graphNodes, graphEdges,
    chats,
    chatNodes:   chatNodes.filter(n => allowedChatIds.has(n.chatId)),
    messages:    messages.filter(m => allowedChatIds.has(m.chatId)),
    reflections: reflectionsRaw.filter(Boolean) as Reflection[],
  });
}
