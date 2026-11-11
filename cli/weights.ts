/**
 * cli/weights.ts — the files setup.sh treats as a finished turbo download.
 */

export const WEIGHT_FILES = [
  "acestep-v15-turbo/model.safetensors",
  "acestep-5Hz-lm-1.7B/model.safetensors",
  "Qwen3-Embedding-0.6B/model.safetensors",
  "vae/diffusion_pytorch_model.safetensors",
] as const;
