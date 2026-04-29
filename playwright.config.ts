import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

import { defineConfig, devices } from "@playwright/test";

const isCI = Boolean(process.env.CI);

process.env.PLAYWRIGHT_TMP_DIR ??= mkdtempSync(join(tmpdir(), "playwright-tmp-"));

export default defineConfig({
  testDir: "./tests/integration/",
  outputDir: "./tests/integration/.output/",
  globalSetup: "./tests/integration/global-setup.ts",
  reporter: isCI ? [["dot"]] : [["list"], ["html", { outputFolder: "./tests/integration/.report/", open: "never" }]],
  timeout: 60000,
  expect: {
    timeout: 5000,
  },
  use: {
    baseURL: "http://localhost:51234",
    headless: true,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
    },
  ],
  webServer: {
    command: "nuxt preview --port=51234 --dotenv=.none",
    url: "http://localhost:51234",
    timeout: 60000,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      NITRO_CLUSTER_WORKERS: "1",
      NUXT_DATABASE_URL: `file://${process.env.PLAYWRIGHT_TMP_DIR}/pglite`,
      NUXT_AUTH_MODE: "single-user",
      NUXT_SINGLE_USER_USERNAME: "admin",
      NUXT_SINGLE_USER_FULLNAME: "Admin",
      NUXT_SINGLE_USER_EMAIL: "admin@localhost",
      NUXT_SEED_CONFIG: JSON.stringify({
        llmProviders: [
          {
            name: "Mock LLM",
            apiUrl: "http://localhost:51235/v1",
            apiKey: "hunter2",
            access: {
              editors: { users: ["admin"] },
              users: { users: ["admin"] },
            },
          },
        ],
        mcpServers: [
          {
            name: "Mock MCP",
            url: "http://localhost:51236/mcp",
            access: {
              editors: { users: ["admin"] },
              users: { users: ["admin"] },
            },
          },
        ],
        skills: [
          {
            name: "rot13",
            description: "Encodes or decodes text using the ROT13 cipher",
            documentation: [
              "# ROT13 Cipher Skill",
              "",
              "This skill encodes or decodes text using the ROT13 substitution cipher.",
              "ROT13 replaces each letter with the letter 13 positions after it in the alphabet.",
              "",
              "## Parameters",
              "",
              "- `text` (string): The text to encode or decode",
              "",
              "## Returns",
              "",
              "An object with:",
              "- `original`: The input text",
              "- `encoded`: The ROT13-transformed text",
              "",
              "## Example",
              "",
              "```js",
              'const result = await $rot13({ text: "Hello World" });',
              '// result.encoded === "Uryyb Jbeyq"',
              "```",
            ].join("\n"),
            code: [
              "/**",
              " * Encodes or decodes text using the ROT13 cipher.",
              " * @param {Object} params",
              " * @param {string} params.text - The text to encode/decode",
              " */",
              "export default async function (params) {",
              "  const original = params.text || '';",
              "  const encoded = original.replace(/[a-zA-Z]/g, (c) => {",
              "    const base = c <= 'Z' ? 65 : 97;",
              "    return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);",
              "  });",
              "  return { original, encoded };",
              "}",
            ].join("\n"),
            access: {
              editors: { users: ["admin"] },
              users: { users: ["admin"] },
            },
          },
        ],
        agents: [
          {
            name: "Mock specialist tool agent",
            description: "A specialist agent for testing purposes",
            instructions: "You are a helpful specialist agent used for testing.",
            type: "specialist",
            llmProvider: "Mock LLM",
            model: "goody-2",
            mcpServers: ["Mock MCP"],
            skills: ["rot13"],
            access: {
              editors: { users: ["admin"] },
              users: { users: ["admin"] },
            },
          },
          {
            name: "Mock specialist code agent",
            description: "A specialist agent for testing purposes",
            instructions: "You are a helpful specialist agent used for testing.",
            type: "specialist",
            llmProvider: "Mock LLM",
            model: "goody-2",
            codeInterpreter: true,
            mcpServers: ["Mock MCP"],
            skills: ["rot13"],
            access: {
              editors: { users: ["admin"] },
              users: { users: ["admin"] },
            },
          },
          {
            name: "Mock triage agent",
            description: "A triage agent for testing purposes",
            instructions: "You are a helpful triage agent used for testing.",
            type: "triage",
            llmProvider: "Mock LLM",
            model: "goody-2",
            specialists: ["Mock specialist tool agent", "Mock specialist code agent"],
            access: {
              editors: { users: ["admin"] },
              users: { users: ["admin"] },
            },
          },
        ],
      }),
      NUXT_LOG_LEVEL: "debug",
    },
  },
});
