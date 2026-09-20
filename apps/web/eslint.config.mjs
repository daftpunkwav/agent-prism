/**
 * @file eslint.config
 * @description ESLint configuration for the web app.
 *
 * Responsibilities:
 * - Apply the shared lint rules to the Next.js source tree
 */

import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    rules: {
      // React 19 rule: allow state resets inside effects (file-switch / panel-switch scenarios)
      "react-hooks/set-state-in-effect": "warn",
      // Allow non-null assertions in justified cases
      "@typescript-eslint/no-non-null-assertion": "warn",
    },
  },
  {
    // renderHook wrappers live in .ts files (no JSX), and I18nProvider's props type
    // requires children; passing children via the createElement third argument fails
    // the typed overload, so children-as-prop is the only type-safe form here.
    files: ["tests/**/*.ts"],
    rules: {
      "react/no-children-prop": "off",
    },
  },
]);

export default eslintConfig;
