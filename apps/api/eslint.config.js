const js = require("@eslint/js");
const globals = require("globals");
const tseslint = require("typescript-eslint");
const codeiqPreset = require("@codeiq/config/eslint-preset");

module.exports = [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    plugins: codeiqPreset.plugins,
    rules: {
      ...codeiqPreset.rules,
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    // This file itself is CommonJS tooling config, not app source.
    files: ["eslint.config.js"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  {
    ignores: ["dist/**"],
  },
];
