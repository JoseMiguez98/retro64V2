// @ts-check
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

// Flat config for the whole monorepo — one config at the root rather than one
// per package, because the packages share a single TS setup (tsconfig.base.json)
// and the rule set should not drift between them.
//
// Deliberately NOT type-aware (`recommendedTypeChecked`): `pnpm typecheck` already
// runs `tsc --noEmit` over every package in CI, so type-aware rules would re-do
// that work for a second time budget without catching much `tsc` doesn't.
// Lint here is about the things the compiler is happy to let through.

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/playwright-report/**",
      "**/test-results/**",
      "**/*.d.ts",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    rules: {
      // Unused vars are an error, but an underscore prefix is the documented
      // way to say "intentionally unused" (destructured rest, unused catch
      // binding, required-but-ignored callback params).
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },

  // Browser-side code.
  {
    files: ["packages/web/**/*.ts"],
    languageOptions: { globals: globals.browser },
  },

  // Node-side code: the signaling server, the e2e harness, and any config files.
  {
    files: [
      "packages/signaling/**/*.ts",
      "packages/e2e/**/*.ts",
      "**/*.config.{js,ts}",
    ],
    languageOptions: { globals: globals.node },
  },

  // Shared wire types are consumed by both sides.
  {
    files: ["packages/shared/**/*.ts"],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
);
