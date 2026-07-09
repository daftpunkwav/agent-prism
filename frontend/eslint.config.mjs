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
      // React 19 新增规则：允许 effect 内重置状态（文件切换/面板切换场景）
      "react-hooks/set-state-in-effect": "warn",
      // 允许合理场景下的非 null 断言
      "@typescript-eslint/no-non-null-assertion": "warn",
    },
  },
]);

export default eslintConfig;
