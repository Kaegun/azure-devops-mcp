# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MCP (Model Context Protocol) server for Azure DevOps. Acts as a thin abstraction layer over Azure DevOps REST APIs, enabling language models and IDEs (VS Code/Copilot, Claude Code, Cursor) to interact with Azure DevOps services.

## Common Commands

```bash
npm run build          # Compile TypeScript (generates version.ts first)
npm run watch          # Watch mode compilation
npm test               # Run all Jest tests
npm test -- test/src/domains.test.ts   # Run a single test file
npm test -- --coverage # Tests with coverage report
npm run format         # Format with Prettier
npm run format-check   # Check formatting
npm run eslint         # Lint
npm run eslint-fix     # Lint and fix
npm run validate-tools # Validate tool names and generate registry
npm run inspect        # Start MCP Inspector for debugging
```

## Architecture

### Entry Points and Flow

1. `src/index.ts` — CLI argument parsing (yargs), server initialization, organization setup
2. `src/tools.ts` — Central `configureAllTools()` that delegates to domain-specific registration functions
3. `src/tools/{domain}.ts` — Each file implements tools for one domain (e.g., `repositories.ts`, `wiki.ts`)

### Organization Modes

- **Single-Org Mode**: Organization specified via CLI args (backward compatible)
- **Multi-Org Mode**: Config file at `~/.ado-mcp-orgs.json` supports multiple orgs with runtime switching via `switch_organization` tool

Key classes: `OrganizationManager` and `OrganizationContext` in `src/organization-context.ts`, config loading in `src/config.ts`.

### 9 Tool Domains

`core`, `work`, `work-items`, `search`, `test-plans`, `repositories`, `wiki`, `pipelines`, `advanced-security`

Domains can be filtered via `-d` CLI flag or config file to reduce tool count for clients with limits.

### Tool Registration Pattern

Every tool follows this pattern in its domain file:

```typescript
server.tool(
  "tool_action_name",
  "Human description",
  { param1: z.string().describe("...") },
  withOrganizationContext(
    "tool_action_name",
    async (params) => {
      // Call Azure DevOps API
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
    orgManager,
    Domain.DOMAIN_NAME
  )
);
```

- `withOrganizationContext()` wraps every tool to validate org selection and domain enablement
- All tools return `{ content: [...], isError?: true }` format
- Parameters validated with Zod schemas; `.describe()` provides docs to MCP clients

### Authentication

Supports 4 auth types: `interactive` (browser OAuth), `azcli`, `env`, `envvar`. Implementation in `src/auth.ts`. Falls back to interactive auth if primary method fails. Token caching for silent acquisition.

### Logging

Winston logger outputs to stderr (to avoid interfering with MCP stdio protocol). Log level controlled by `LOG_LEVEL` env var.

## Code Conventions

- **Tool names**: `<domain>_<action>` pattern (e.g., `repo_create_pull_request`, `core_list_projects`). Must match `^[a-zA-Z0-9_.-]{1,64}$`.
- **Constants**: `SCREAMING_SNAKE_CASE` — **Variables/functions**: `camelCase` — **Classes**: `PascalCase` — **Files**: `kebab-case.ts`
- **Formatting**: Prettier with 200 char print width, double quotes, trailing commas in ES5 positions, LF line endings
- **Copyright header**: Required on all `src/` files except `index.ts` (enforced by ESLint)
- Custom ESLint rule (`eslint-rules/tool-name-lint-rule.js`) validates tool/parameter names in `src/tools/*.ts`

## Testing

- Jest with ts-jest, tests in `test/` directory mirroring `src/` structure
- Coverage threshold: 40% minimum (branches, functions, lines, statements)
- Mock the logger in tests: `jest.mock("../../src/logger.js", () => ({ logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() } }))`
- `tsconfig.jest.json` uses CommonJS module resolution for Jest compatibility

## Contributing Requirements

- Tools must be simple and focused — no complex multi-step operations
- All PRs require tests; tests must pass in CI
- Create an issue before submitting a PR
