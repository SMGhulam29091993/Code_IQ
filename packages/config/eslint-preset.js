// Shared ESLint rules — import order enforced per .ai/rules/coding-standards.md:
// 1. Node built-ins  2. External packages  3. Internal packages (@codeiq/*)  4. Relative (deepest first)
module.exports = {
  plugins: { import: require("eslint-plugin-import") },
  rules: {
    "import/order": [
      "error",
      {
        groups: ["builtin", "external", "internal", ["parent", "sibling", "index"]],
        pathGroups: [
          { pattern: "@codeiq/**", group: "internal", position: "before" },
        ],
        pathGroupsExcludedImportTypes: ["builtin"],
        "newlines-between": "never",
        alphabetize: { order: "asc", caseInsensitive: true },
      },
    ],
    "@typescript-eslint/no-explicit-any": "error",
  },
};
