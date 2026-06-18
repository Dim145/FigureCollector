import js from "@eslint/js";
import globals from "globals";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  js.configs.recommended,
  {
    files: ["src/**/*.{js,jsx}"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      // Use the `globals` package preset rather than maintaining our own
      // list — `eslint-plugin-react-hooks` 7 picks up many more browser-
      // platform identifiers (IntersectionObserver, requestAnimationFrame,
      // Blob, etc.) than v5 did, so the inline list got too long to track.
      globals: {
        ...globals.browser,
        ...globals.serviceworker,
        // Injected at build time by Vite `define` (see vite.config.js).
        __APP_VERSION__: "readonly",
      },
    },
    plugins: {
      react,
      "react-hooks": reactHooks,
    },
    rules: {
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off",
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      // New in `eslint-plugin-react-hooks` 7 — flags setState calls inside
      // effect bodies. The rule is principled but we have several legitimate
      // patterns (subscribe-and-mirror, debounce/throttle) that trip it; keep
      // it as a warning instead of failing the lint so the signal isn't lost.
      "react-hooks/set-state-in-effect": "warn",
      // Also new in v7 — flags ref-map mutation and TDZ-style access to
      // useCallback'd functions inside effects. Both are legitimate React
      // idioms in our codebase; downgrade to warn rather than error.
      "react-hooks/immutability": "warn",
    },
    settings: {
      react: { version: "detect" },
    },
  },
];
