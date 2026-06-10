// src/lib/search/embedding/models.ts
// Local embedding models available for semantic search. bge-small is the
// auto-downloaded default (small, MIT, strong English retrieval);
// EmbeddingGemma is the opt-in premium pick (multilingual, ~6x the
// download). BGE-style models need an instruction prefix on QUERIES only;
// EmbeddingGemma prefixes both sides.

export interface EmbeddingModelSpec {
  id:          string;     // stable internal id stored in prefs + vector rows
  hfId:        string;     // hugging face repo for transformers.js
  dims:        number;
  dtype:       string;     // quantization passed to transformers.js
  queryPrefix: string;
  docPrefix:   string;
  label:       string;
  sizeLabel:   string;
  note:        string;
}

export const EMBEDDING_MODELS: EmbeddingModelSpec[] = [
  {
    id:          "bge-small",
    hfId:        "Xenova/bge-small-en-v1.5",
    dims:        384,
    dtype:       "q8",
    queryPrefix: "Represent this sentence for searching relevant passages: ",
    docPrefix:   "",
    label:       "BGE Small (English)",
    sizeLabel:   "~34 MB",
    note:        "Recommended — downloads automatically in the background.",
  },
  {
    id:          "embeddinggemma",
    hfId:        "onnx-community/embeddinggemma-300m-ONNX",
    dims:        768,
    dtype:       "q4",
    queryPrefix: "task: search result | query: ",
    docPrefix:   "title: none | text: ",
    label:       "EmbeddingGemma 300m (multilingual)",
    sizeLabel:   "~200 MB",
    note:        "Higher quality, 100+ languages. Switching re-indexes everything.",
  },
];

export const DEFAULT_EMBEDDING_MODEL_ID = "bge-small";

export function getEmbeddingModel(id: string): EmbeddingModelSpec {
  return EMBEDDING_MODELS.find(m => m.id === id)
    ?? EMBEDDING_MODELS.find(m => m.id === DEFAULT_EMBEDDING_MODEL_ID)!;
}