// src/lib/path.ts
// Tree layout helpers for the TreeMap overlay and path-finding.
import type { Node } from "./db";

export interface TreeNode {
  node:     Node;
  children: TreeNode[];
}

export interface LayoutPoint {
  nodeId: string;
  x:      number;
  y:      number;
  depth:  number;
}

// Build forest of TreeNodes from flat list. Children sorted by createdAt.
export function buildTree(nodes: Node[]): TreeNode[] {
  const map = new Map<string, TreeNode>();
  for (const n of nodes) map.set(n._id, { node: n, children: [] });

  const roots: TreeNode[] = [];
  for (const n of nodes) {
    const wrapped = map.get(n._id)!;
    if (n.parentId === null) {
      roots.push(wrapped);
    } else {
      const parent = map.get(n.parentId);
      if (parent) parent.children.push(wrapped);
      else        roots.push(wrapped); // orphan: treat as root
    }
  }

  const byCreated = (a: TreeNode, b: TreeNode) => a.node.createdAt - b.node.createdAt;
  for (const wrapped of map.values()) wrapped.children.sort(byCreated);
  roots.sort(byCreated);
  return roots;
}

// DFS layout: x = sibling index counter (incremented per leaf visit), y = depth.
export function layoutTree(roots: TreeNode[]): LayoutPoint[] {
  const out: LayoutPoint[] = [];
  let cursor = 0;

  const visit = (tn: TreeNode, depth: number): void => {
    const xStart = cursor;
    if (tn.children.length === 0) {
      out.push({ nodeId: tn.node._id, x: cursor, y: depth, depth });
      cursor += 1;
      return;
    }
    for (const child of tn.children) visit(child, depth + 1);
    const xEnd = cursor - 1;
    out.push({ nodeId: tn.node._id, x: (xStart + xEnd) / 2, y: depth, depth });
  };

  for (const root of roots) visit(root, 0);
  return out;
}

// Return ancestor IDs from root to targetId (inclusive). Empty if not found.
export function findPath(nodes: Node[], targetId: string): string[] {
  const map = new Map(nodes.map(n => [n._id, n]));
  const path: string[] = [];
  const seen = new Set<string>();
  let currentId: string | null = targetId;
  while (currentId) {
    if (seen.has(currentId)) return [];
    seen.add(currentId);
    const node = map.get(currentId);
    if (!node) return [];
    path.unshift(node._id);
    currentId = node.parentId;
  }
  return path;
}
