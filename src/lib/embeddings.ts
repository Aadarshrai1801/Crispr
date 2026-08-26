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

/** Max sequences per ONNX run — keeps attention buffers bounded for large docs. */
const EMBED_BATCH_SIZE = 32;

/** Embed a batch of texts into normalized unit vectors. */
export async function embed(texts: string[]): Promise<number[][]> {
  if (!texts.length) return [];
  const extractor = await getEmbedder();
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
    const output = await extractor(texts.slice(i, i + EMBED_BATCH_SIZE), {
      pooling: "mean",
      normalize: true,
    });
    const list = output.tolist() as number[][];
    out.push(...list);
    if (out[0]) setEmbedDim(out[0].length);
  }
  return out;
}

export async function embedOne(text: string): Promise<number[]> {
  const [vec] = await embed([text]);
  return vec;
}
