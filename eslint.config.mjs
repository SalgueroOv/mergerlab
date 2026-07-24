import js from "@eslint/js";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import prettierConfig from "eslint-config-prettier";
import globals from "globals";

export default [
  {
    ignores: ["dist/**", "release/**", "build/**", "resources/**", "node_modules/**", "backend/venv/**"],
  },

  js.configs.recommended,

  // Frontend (React + Vite): módulos ES, JSX, entorno de navegador.
  {
    files: ["src/**/*.{js,jsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser },
    },
    plugins: { react, "react-hooks": reactHooks },
    settings: { react: { version: "18.3" } },
    rules: {
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      "react/react-in-jsx-scope": "off", // JSX runtime automático (Vite + React 18)
      "react/prop-types": "off", // proyecto sin PropTypes/TypeScript
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },

  // Proceso principal de Electron: CommonJS, entorno Node.
  {
    files: ["electron/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: { ...globals.node },
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },

  // splash.js corre en un renderer sin bundler (script clásico cargado por splash.html), no en
  // Node ni con módulos: entorno de navegador puro.
  {
    files: ["electron/splash.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: { ...globals.browser },
    },
  },

  // Configs de build en la raíz (Node, ES modules).
  {
    files: ["vite.config.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.node },
    },
  },

  prettierConfig,
];
