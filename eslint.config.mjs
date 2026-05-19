import js from "@eslint/js";
import globals from "globals";
import { defineConfig } from "eslint/config";

export default defineConfig([
  {
    files: ["**/*.{js,mjs,cjs}"],
    plugins: { js },
    extends: ["js/recommended"],
    languageOptions: {
      globals: {
        // Browser APIs (DOM, fetch, etc.)
        ...globals.browser,

        // WebExtension / Chrome Extension APIs
        ...globals.webextensions,
      },
    },
    rules: {
      // Warn on unused variables, but allow unused function params (common in event listeners)
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],

      // Warn instead of error for console usage (useful during extension development)
      "no-console": "off",
    },
  },

  // Ignore non-source directories
  {
    ignores: ["node_modules/", "web-ext-artifacts/", "assets/", "dist/"],
  },

  // Node.js scripts configuration
  {
    files: ["scripts/**/*.js"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
]);
