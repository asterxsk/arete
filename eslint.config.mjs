import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";
import importPlugin from "eslint-plugin-import";

export default [
  {
    ignores: [
      "node_modules",
      "**/node_modules",
      "**/dist",
      "**/build",
      "**/*.d.ts",
      "agent/extensions/subagents/node_modules",
      "agent/extensions/**/node_modules",
      "artifacts",
      "droid-wiki",
      ".factory",
      ".git",
      "eslint.config.mjs",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  importPlugin.flatConfigs.recommended,
  {
    files: ["**/*.{ts,tsx,js,jsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        node: "readonly",
        console: "readonly",
        process: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        window: "readonly",
        document: "readonly",
        globalThis: "readonly",
      },
    },
    rules: {
      "@typescript-eslint/naming-convention": [
        "warn",
        {
          selector: "default",
          format: ["camelCase"],
          leadingUnderscore: "allow",
          trailingUnderscore: "allow",
        },
        {
          selector: "variable",
          format: ["camelCase", "UPPER_CASE", "PascalCase"],
          leadingUnderscore: "allow",
          trailingUnderscore: "allow",
        },
        {
          selector: "function",
          format: ["camelCase", "PascalCase"],
          leadingUnderscore: "allow",
        },
        {
          selector: "typeLike",
          format: ["PascalCase"],
        },
        {
          selector: "enumMember",
          format: ["PascalCase", "UPPER_CASE"],
        },
        {
          selector: "property",
          format: null,
        },
        {
          selector: ["objectLiteralProperty", "typeProperty", "classProperty"],
          format: null,
        },
      ],
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/explicit-module-boundary-types": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "no-undef": "off",
      "no-empty": "off",
      "no-console": "off",
      "no-control-regex": "off",
      "no-useless-escape": "off",
      "prefer-rest-params": "off",
      "no-prototype-builtins": "off",
      "no-case-declarations": "off",
      "@typescript-eslint/ban-types": "off",
      "@typescript-eslint/no-unsafe-function-type": "off",
      "prefer-const": "warn",
      "@typescript-eslint/no-require-imports": "warn",
      "@typescript-eslint/no-this-alias": "off",
      "complexity": ["warn", { max: 25 }],
      "import/no-duplicates": "warn",
      "import/no-unresolved": "off",
      "import/named": "off",
      "import/no-unused-modules": "warn",
    },
  },
];
