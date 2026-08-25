import { pipeline, env } from "@huggingface/transformers";
import type { FeatureExtractionPipeline } from "@huggingface/transformers";
import { mkdirSync } from "node:fs";
import { config, modelsCacheDir } from "./config";
import { setEmbedDim } from "./vector";

declare global {
  var __crispEmbedder: Promise<FeatureExtractionPipeline> | undefined;
}

env.allowLocalModels = false;

async function load(): Promise<FeatureExtractionPipeline> {
  mkdirSync(modelsCacheDir(), { recursive: true });
  env.cacheDir = modelsCacheDir();
  // transformers.js union-typed overloads blow up TS inference; pin via cast
  const factory = pipeline as unknown as (task: string, model: string, opts?: Record<string, unknown>) => Promise<FeatureExtractionPipeline>;
  return await factory("feature-extraction", config.embeddingModel, { dtype: "fp32" });
}

function getEmbedder(): Promise<FeatureExtractionPipeline> {
  globalThis.__crispEmbedder ??= load().catch((err) => {
    globalThis.__crispEmbedder = undefined;
    throw err;
  });
  return globalThis.__crispEmbedder;
}

/** Embed a batch of texts into normalized unit vectors. */
export async function embed(texts: string[]): Promise<number[][]> {
  if (!texts.length) return [];
  const extractor = await getEmbedder();
  const output = await extractor(texts, { pooling: "mean", normalize: true });
  const list = output.tolist() as number[][];
  if (list[0]) setEmbedDim(list[0].length);
  return list;
}

export async function embedOne(text: string): Promise<number[]> {
  const [vec] = await embed([text]);
  return vec;
}
