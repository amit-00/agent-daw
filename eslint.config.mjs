import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  { files: ["test/**/*.ts"], rules: { "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }] } },
  globalIgnores([".worktrees/**", ".next/**", "out/**", "next-env.d.ts"]),
]);
