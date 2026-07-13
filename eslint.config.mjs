import eslint from "@eslint/js";
import minecraftLinting from "eslint-plugin-minecraft-linting";
import globals from "globals";
import tseslint from "typescript-eslint";

const typedFiles = [
  "src/**/*.ts",
  "src/**/*.tsx",
  "tests/**/*.ts",
  "vitest.config.ts",
];

export default tseslint.config(
  {
    ignores: ["coverage/**", "dist/**", "node_modules/**", "vendor/**"],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked.map((config) => ({
    ...config,
    files: typedFiles,
  })),
  {
    files: ["**/*.mjs"],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ["web/**/*.js"],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    files: typedFiles,
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "minecraft-linting": minecraftLinting,
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/explicit-function-return-type": "error",
      "@typescript-eslint/no-floating-promises": "error",
    },
  },
);
