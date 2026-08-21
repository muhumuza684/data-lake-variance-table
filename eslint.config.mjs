import globals from "globals";
import tsParser from "@typescript-eslint/parser";
export default [
  { ignores: ["node_modules/**", "dist/**", "coverage/**", "webpack.statistics.*"] },
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: { globals: { ...globals.node }, parser: tsParser, ecmaVersion: 2023, sourceType: "module" },
    rules: { "no-unused-vars": "off" }
  }
];