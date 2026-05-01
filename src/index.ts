#!/usr/bin/env node

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { getBearerHandler, getPersonalAccessTokenHandler, WebApi } from "azure-devops-node-api";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import { logger } from "./logger.js";
//import { configurePrompts } from "./prompts.js";
import { configureAllTools } from "./tools.js";
import { UserAgentComposer } from "./useragent.js";
import { packageVersion } from "./version.js";
import { DomainsManager } from "./shared/domains.js";
import { OrganizationManager, OrganizationConfig } from "./organization-context.js";
import { ConfigManager, AdoMcpConfig } from "./config.js";

function isGitHubCodespaceEnv(): boolean {
  return process.env.CODESPACES === "true" && !!process.env.CODESPACE_NAME;
}

const defaultAuthenticationType = isGitHubCodespaceEnv() ? "azcli" : "interactive";

// Parse command line arguments using yargs
const argv = yargs(hideBin(process.argv))
  .scriptName("mcp-server-azuredevops")
  .usage("Usage: $0 <organization> [options]")
  .version(packageVersion)
  .command("$0 <organization> [options]", "Azure DevOps MCP Server", (yargs) => {
    yargs.positional("organization", {
      describe: "Azure DevOps organization name",
      type: "string",
      demandOption: true,
    });
  })
  .option("domains", {
    alias: "d",
    describe: "Domain(s) to enable: 'all' for everything, or specific domains like 'repositories builds work'. Defaults to 'all'.",
    type: "string",
    array: true,
    default: "all",
  })
  .option("authentication", {
    alias: "a",
    describe: "Type of authentication to use",
    type: "string",
    choices: ["interactive", "azcli", "env", "envvar", "pat"],
    default: defaultAuthenticationType,
  })
  .option("tenant", {
    alias: "t",
    describe: "Azure tenant ID (optional, applied when using 'interactive' and 'azcli' type of authentication)",
    type: "string",
  })
  .help()
  .parseSync();

// Global exports for backward compatibility in single-org mode
export let orgName = "";
export let enabledDomains = new Set<string>();

// Helper function to set global context for backward compatibility
function setGlobalOrgContext(organization: string, domains: Set<string>) {
  orgName = organization;
  enabledDomains = domains;
}

function getAzureDevOpsClient(orgManager: OrganizationManager, getAzureDevOpsToken: () => Promise<string>, userAgentComposer: UserAgentComposer, authType: string): () => Promise<WebApi> {
  return async () => {
    const context = orgManager.getCurrentContext();
    if (!context) {
      throw new Error("No organization context selected");
    }
    const accessToken = await getAzureDevOpsToken();
    // For pat, accessToken is base64("{email}:{token}"). Decode to extract the token part,
    // since getPersonalAccessTokenHandler prepends ":" internally and just needs the raw token.
    const authHandler = authType === "pat" ? getPersonalAccessTokenHandler(Buffer.from(accessToken, "base64").toString("utf8").split(":").slice(1).join(":")) : getBearerHandler(accessToken);
    const connection = new WebApi(context.orgUrl, authHandler, undefined, {
      productName: "AzureDevOps.MCP",
      productVersion: packageVersion,
      userAgent: userAgentComposer.userAgent,
    });
    return connection;
  };
}

/**
 * Initialize single organization mode (CLI args or CLI override)
 */
async function initializeSingleOrgMode(orgManager: OrganizationManager, argv: any): Promise<void> {
  logger.info("Starting in single-organization mode", { organization: argv.organization });

  const config: OrganizationConfig = {
    id: argv.organization,
    orgName: argv.organization,
    authType: argv.authentication,
    tenantId: argv.tenant,
    domains: typeof argv.domains === "string" ? argv.domains.split(",") : argv.domains,
  };

  await orgManager.addOrganization(config);
  await orgManager.switchTo(config.id);

  // Set global context for backward compatibility
  const domainsManager = new DomainsManager(argv.domains);
  setGlobalOrgContext(config.orgName, domainsManager.getEnabledDomains());
}

/**
 * Initialize multi-organization mode (config file)
 */
async function initializeMultiOrgMode(orgManager: OrganizationManager, config: AdoMcpConfig): Promise<void> {
  logger.info("🏢 Starting in multi-organization mode");
  logger.info("✅ Configuration already loaded, processing organizations...");

  // Add all organizations from config
  for (const [id, orgConfig] of Object.entries(config.organizations)) {
    logger.info(`🏢 Adding organization: ${id} (${orgConfig.orgName})`);

    const orgConfiguration: OrganizationConfig = {
      id,
      orgName: orgConfig.orgName,
      authType: orgConfig.authType || "azcli",
      domains: orgConfig.domains || ["all"],
    };

    logger.debug(`   Organization config: ${JSON.stringify(orgConfiguration)}`);
    await orgManager.addOrganization(orgConfiguration);
    logger.info(`   ✅ Successfully added: ${id}`);
  }

  // Auto-select default organization if specified
  if (config.defaultOrganization) {
    logger.info(`🎯 Attempting to auto-select default organization: ${config.defaultOrganization}`);

    if (orgManager.hasOrganization(config.defaultOrganization)) {
      await orgManager.switchTo(config.defaultOrganization);
      logger.info("✅ Auto-selected default organization", { organization: config.defaultOrganization });
    } else {
      logger.warn(`⚠️  Default organization '${config.defaultOrganization}' not found in loaded organizations`);
      logger.info(`Available organizations: ${orgManager.listOrganizations().join(", ")}`);
    }
  } else {
    logger.info("ℹ️  No default organization specified in config");
  }

  logger.info("✅ Multi-organization mode initialized", {
    organizations: orgManager.listOrganizations(),
    defaultOrganization: config.defaultOrganization,
    currentOrganization: orgManager.getCurrentOrganizationId(),
  });
}

async function main() {
  logger.info("🚀 Starting Azure DevOps MCP Server initialization", {
    version: packageVersion,
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    argv: process.argv,
    cwd: process.cwd(),
    env: {
      USER: process.env.USER,
      HOME: process.env.HOME,
      SHELL: process.env.SHELL,
      PATH: process.env.PATH ? process.env.PATH.substring(0, 100) + "..." : "undefined",
    },
  });

  const server = new McpServer({
    name: "Azure DevOps MCP Server",
    version: packageVersion,
    icons: [
      {
        src: "https://cdn.vsassets.io/content/icons/favicon.ico",
      },
    ],
  });

  const userAgentComposer = new UserAgentComposer(packageVersion);
  server.server.oninitialized = () => {
    userAgentComposer.appendMcpClientInfo(server.server.getClientVersion());
  };

  // Initialize organization manager
  const orgManager = new OrganizationManager(userAgentComposer);

  // Always attempt to load config first, then decide mode
  logger.info("🔍 Checking for multi-organization configuration...");

  const config = await ConfigManager.loadConfig();

  if (config && Object.keys(config.organizations).length > 1) {
    logger.info("🏢 Multi-organization mode detected (config file with multiple organizations)");
    await initializeMultiOrgMode(orgManager, config);
  } else {
    logger.info("📍 Single-organization mode detected (using CLI argument)");
    await initializeSingleOrgMode(orgManager, argv);
  }

  logger.info("Azure DevOps MCP Server initialization complete", {
    mode: config && Object.keys(config.organizations).length > 1 ? "multi-org" : "single-org",
    currentOrganization: orgManager.getCurrentOrganizationId(),
    availableOrganizations: orgManager.listOrganizations(),
    version: packageVersion,
    isCodespace: isGitHubCodespaceEnv(),
  });

  // Token provider that always resolves against the currently-selected org
  const authenticator: () => Promise<string> = async () => {
    const context = orgManager.getCurrentContext();
    if (!context) {
      throw new Error("No organization context selected");
    }
    return context.authenticator();
  };

  if (argv.authentication === "pat") {
    const basicValue = await authenticator();
    // basicValue is already base64("{email}:{token}") — use it directly in the Authorization header
    const _originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.headers) {
        const headers = new Headers(init.headers as HeadersInit);
        if (headers.get("Authorization")?.startsWith("Bearer ")) {
          headers.set("Authorization", `Basic ${basicValue}`);
          init = { ...init, headers };
        }
      }
      return _originalFetch(input, init);
    };
    logger.debug("PAT mode: global fetch interceptor installed to rewrite Bearer -> Basic auth headers");
  }

  // removing prompts untill further notice
  // configurePrompts(server);

  configureAllTools(server, authenticator, getAzureDevOpsClient(orgManager, authenticator, userAgentComposer, argv.authentication), () => userAgentComposer.userAgent, enabledDomains, orgManager);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  logger.error("Fatal error in main():", error);
  process.exit(1);
});
