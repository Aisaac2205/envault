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
    // Vendored bklit chart components (shadcn registry code, copied rather than
    // authored here). They export helpers next to components, read refs during
    // render and use hand-tuned effect deps, so the style rules that would force
    // a restructure are off for this folder only. Type checking and the rest of
    // the lint rules still apply.
    files: ["src/shared/ui/charts/**/*.{ts,tsx}"],
    rules: {
      "react-refresh/only-export-components": "off",
      "react-hooks/exhaustive-deps": "off",
      "react-hooks/refs": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
);
