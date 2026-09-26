import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";

export default tseslint.config(
  { ignores: ["dist", "node_modules", "coverage"] },
  {
    extends: [js.configs.recommended],
    files: ["**/*.{ts,tsx}"],
  },
  {
    extends: [...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: {
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    plugins: { "react-hooks": reactHooks },
    files: ["**/*.{ts,tsx}"],
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Pre-existing patterns in feature files need refactoring — downgraded
      // from error to warn until features are updated in later PRs (5-11).
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  {
    // react-refresh only applies to component files (not test files)
    plugins: { "react-refresh": reactRefresh },
    files: ["**/*.{ts,tsx}"],
    ignores: ["**/*.test.{ts,tsx}", "**/test/**"],
    rules: {
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
    },
  },
  {
    // Vendored bklit chart source (installed via `shadcn add @bklit/*`,
    // apps/web/src/shared/ui/charts/**). We do not hand-maintain this code,
    // so only the rules that actually fire here are scoped off — `any` stays
    // banned (see the `// envault:` CurveFactory patches) and `unknown` is
    // the one upstream pattern we keep.
    files: ["src/shared/ui/charts/**/*.{ts,tsx}"],
    rules: {
      // Upstream reads refs during render for spring/animation bookkeeping
      // (e.g. use-highlight-segment.ts, use-mount-progress.ts, x-axis.tsx).
      "react-hooks/refs": "off",
      // Upstream calls setState synchronously inside effects to drive chart
      // phase transitions (use-chart-phase-orchestrator.ts and friends).
      "react-hooks/set-state-in-effect": "off",
      // Upstream effect deps are intentionally partial in several hooks
      // (mirrors the upstream bklit registry, not our code to fix).
      "react-hooks/exhaustive-deps": "off",
      // Several files (chart-context.tsx, index.ts) re-export types and
      // helpers alongside components, which is the upstream module shape.
      "react-refresh/only-export-components": "off",
      // chart-context.tsx keeps unused generic type params (`_Input`) for
      // documentation/inference parity with the upstream scale types.
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
);
