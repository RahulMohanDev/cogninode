// src/hooks/useCostEstimate.ts
import { useMemo }                              from "react";
import { useLiveQuery }                         from "dexie-react-hooks";
import { db }                                   from "../lib/db";
import { estimateCostUsd, getModel }            from "../lib/cost";
import { useSettings }                          from "./useSettings";

export function useCostEstimate(
  composerText: string,
  nodeId:       string,
  chatId:       string,
  modelId:      string,
): number {
  const { prefs } = useSettings();
  const model     = getModel(modelId, prefs.customModels);

  // Get all nodes to build path, reactive via useLiveQuery
  const pathDepth = useLiveQuery(async () => {
    const allNodes = await db.nodes.where("chatId").equals(chatId).toArray();
    const nodeMap  = new Map(allNodes.map(n => [n._id, n]));
    let depth = 0;
    let currentId: string | null = nodeId;
    while (currentId) {
      const node = nodeMap.get(currentId);
      if (!node) break;
      depth++;
      currentId = node.parentId;
    }
    return depth;
  }, [chatId, nodeId]) ?? 1;

  return useMemo(() => {
    if (!model) return 0;
    // Approximate path context: pathDepth nodes × 400 chars each
    const approxPathChars = Math.max(0, pathDepth - 1) * 400;
    const pathMessages = [{ content: "x".repeat(approxPathChars) }];
    return estimateCostUsd(composerText, pathMessages, model);
  }, [composerText, pathDepth, model]);
}
