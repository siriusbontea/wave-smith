import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MIN_BASE_WEIGHT_BYTES, baseModelOnDisk } from "@/lib/engine/base-model";

function writeWeight(file: string): void {
  fs.writeFileSync(file, Buffer.alloc(MIN_BASE_WEIGHT_BYTES, 1));
}

describe("base model on disk", () => {
  it("requires a weight file, not an empty directory", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ws-base-"));
    expect(baseModelOnDisk(root)).toBe(false);
    const dir = path.join(root, "checkpoints", "acestep-v15-base");
    fs.mkdirSync(dir, { recursive: true });
    expect(baseModelOnDisk(root)).toBe(false);
    fs.writeFileSync(path.join(dir, "model.safetensors"), Buffer.from([1]));
    expect(baseModelOnDisk(root)).toBe(false);
    writeWeight(path.join(dir, "model.safetensors"));
    expect(baseModelOnDisk(root)).toBe(true);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("rejects a zero-byte index and accepts an index whose shards exist", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ws-base-"));
    const dir = path.join(root, "checkpoints", "acestep-v15-base");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "model.safetensors.index.json"), "");
    expect(baseModelOnDisk(root)).toBe(false);
    fs.writeFileSync(
      path.join(dir, "model.safetensors.index.json"),
      JSON.stringify({ weight_map: { "layer.weight": "model-00001.safetensors" } }),
    );
    expect(baseModelOnDisk(root)).toBe(false);
    fs.writeFileSync(path.join(dir, "model-00001.safetensors"), "");
    expect(baseModelOnDisk(root)).toBe(false);
    fs.writeFileSync(path.join(dir, "model-00001.safetensors"), Buffer.from([1]));
    expect(baseModelOnDisk(root)).toBe(false);
    writeWeight(path.join(dir, "model-00001.safetensors"));
    expect(baseModelOnDisk(root)).toBe(true);
    fs.rmSync(root, { recursive: true, force: true });
  });
});
