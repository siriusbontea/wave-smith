import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Wavesmith: flat config does not respect .gitignore — keep the engine
    // clone (third-party, ~700 JS files) and runtime data out of lint.
    "engine/**",
    "data/**",
  ]),
]);

export default eslintConfig;
