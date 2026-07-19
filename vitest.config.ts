import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["agent/extensions/**/tests/**/*.test.ts", "agent/extensions/**/tests/**/*.test.js"],
    environment: "node",
    passWithNoTests: true,
    reporters: ["default", "verbose"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["agent/extensions/**/*.ts"],
      exclude: ["agent/extensions/**/tests/**", "agent/extensions/archived/**", "**/*.d.ts"],
      thresholds: {
        statements: 30,
        branches: 20,
        functions: 20,
        lines: 30,
      },
    },
  },
});
