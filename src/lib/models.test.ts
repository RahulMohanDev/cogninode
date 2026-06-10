// src/lib/models.test.ts
import { describe, it, expect } from "vitest";
import {
  mapApiModel,
  formatContext,
  catalogToModelDef,
  resolveModelFrom,
  LEGACY_MODEL_IDS,
  type OpenRouterApiModel,
} from "./models";
import { FALLBACK_MODELS, type CustomModel, type ModelDef } from "./cost";

const RAW: OpenRouterApiModel = {
  id: "openai/gpt-4o-mini",
  name: "OpenAI: GPT-4o Mini",
  created: 1721260800,
  context_length: 128000,
  architecture: {
    input_modalities: ["text", "image"],
    output_modalities: ["text"],
  },
  pricing: { prompt: "0.00000015", completion: "0.0000006" },
  supported_parameters: ["tools", "reasoning"],
};

describe("mapApiModel", () => {
  it("maps an API record: vendor split, per-token → per-M pricing", () => {
    const m = mapApiModel(RAW);
    expect(m).not.toBeNull();
    expect(m!._id).toBe("openai/gpt-4o-mini");
    expect(m!.vendor).toBe("OpenAI");
    expect(m!.name).toBe("GPT-4o Mini");
    expect(m!.promptPerM).toBe(0.15);
    expect(m!.completionPerM).toBe(0.6);
    expect(m!.contextLength).toBe(128000);
  });

  it("undoes float noise on the per-token scale", () => {
    const m = mapApiModel({ ...RAW, pricing: { prompt: "0.0000005", completion: "0.000005" } });
    expect(m!.promptPerM).toBe(0.5);
    expect(m!.completionPerM).toBe(5);
  });

  it("derives the vendor from the id when the name has no prefix", () => {
    const m = mapApiModel({ ...RAW, id: "mistralai/mistral-small", name: "Mistral Small" });
    expect(m!.vendor).toBe("Mistralai");
    expect(m!.name).toBe("Mistral Small");
  });

  it("rejects models without text output", () => {
    const m = mapApiModel({
      ...RAW,
      architecture: { output_modalities: ["image"] },
    });
    expect(m).toBeNull();
  });

  it("rejects unknown or dynamic (-1) pricing", () => {
    expect(mapApiModel({ ...RAW, pricing: { prompt: "-1", completion: "-1" } })).toBeNull();
    expect(mapApiModel({ ...RAW, pricing: {} })).toBeNull();
  });
});

describe("formatContext", () => {
  it("formats k and M ranges", () => {
    expect(formatContext(8192)).toBe("8k");
    expect(formatContext(131072)).toBe("131k");
    expect(formatContext(400000)).toBe("400k");
    expect(formatContext(1048576)).toBe("1M");
    expect(formatContext(0)).toBe("?");
  });
});

describe("catalogToModelDef", () => {
  it("builds the picker tag from context + reasoning support", () => {
    const def = catalogToModelDef(mapApiModel(RAW)!);
    expect(def.tag).toBe("128k ctx · reasoning");
    expect(def.id).toBe(def.openRouterId);
  });
});

describe("resolveModelFrom", () => {
  const catalog: ModelDef[] = [
    { id: "a/x", openRouterId: "a/x", name: "X", vendor: "A", tag: "", inputPricePerM: 1, outputPricePerM: 2 },
    { id: "google/gemini-3.1-flash-lite", openRouterId: "google/gemini-3.1-flash-lite", name: "Flash Lite", vendor: "Google", tag: "", inputPricePerM: 0.25, outputPricePerM: 1.5 },
  ];
  const custom: CustomModel[] = [
    { id: "a/x", openRouterId: "a/x", name: "X (override)", vendor: "", tag: "custom", inputPricePerM: 9, outputPricePerM: 9, isCustom: true },
  ];

  it("prefers custom models over the catalog", () => {
    expect(resolveModelFrom("a/x", catalog, custom)!.name).toBe("X (override)");
    expect(resolveModelFrom("a/x", catalog)!.name).toBe("X");
  });

  it("maps legacy slug ids to live catalog entries", () => {
    expect(resolveModelFrom("flash", catalog)!.id).toBe("google/gemini-3.1-flash-lite");
  });

  it("falls back to FALLBACK_MODELS for legacy ids when the catalog is empty", () => {
    const m = resolveModelFrom("sonnet", []);
    expect(m!.id).toBe("anthropic/claude-sonnet-4.5");
  });

  it("returns undefined for genuinely unknown ids", () => {
    expect(resolveModelFrom("does/not-exist", catalog)).toBeUndefined();
    expect(resolveModelFrom(undefined, catalog)).toBeUndefined();
  });

  it("every legacy target exists in FALLBACK_MODELS", () => {
    for (const target of Object.values(LEGACY_MODEL_IDS)) {
      expect(FALLBACK_MODELS.some(m => m.id === target)).toBe(true);
    }
  });
});