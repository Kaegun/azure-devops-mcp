// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getBearerHandler, WebApi } from "azure-devops-node-api";

import { Domain } from "./shared/domains.js";
import { OrganizationManager } from "./organization-context.js";
import { withOrganizationContext, withOrganizationManagement } from "./tool-wrapper.js";
import { OAuthAuthenticator } from "./auth.js";
import { logger } from "./logger.js";
import { packageVersion } from "./version.js";
import { configureAdvSecTools } from "./tools/advanced-security.js";
import { configureMcpAppsTools } from "./tools/mcp-apps.js";
import { configurePipelineTools } from "./tools/pipelines.js";
import { configureCoreTools } from "./tools/core.js";
import { configureRepoTools } from "./tools/repositories.js";
import { configureSearchTools } from "./tools/search.js";
import { configureTestPlanTools } from "./tools/test-plans.js";
import { configureWikiTools } from "./tools/wiki.js";
import { configureWorkTools } from "./tools/work.js";
import { configureWorkItemTools } from "./tools/work-items.js";

/**
 * Configure organization management tools
 */
function configureOrgManagementTools(server: McpServer, orgManager: OrganizationManager) {
  server.tool(
    "switch_organization",
    "Switch to a different Azure DevOps organization",
    {
      organization: z.string().describe("Organization ID from config file"),
      skipAuthTest: z.boolean().optional().describe("Skip authentication test after switching (default: false)"),
    },
    withOrganizationManagement("switch_organization", async ({ organization, skipAuthTest = false }) => {
      logger.info(`🔄 Starting switch_organization: ${orgManager.getCurrentOrganizationId()} → ${organization}`);

      try {
        // Perform the organization switch
        logger.debug(`Calling orgManager.switchTo(${organization})`);
        const context = await orgManager.switchTo(organization);
        logger.info(`✅ orgManager.switchTo succeeded: ${context.id} (${context.orgName})`);

        let authStatus = "not tested";
        let authDetails = "";

        // Test authentication unless explicitly skipped
        if (!skipAuthTest) {
          logger.debug(`Testing authentication for ${context.orgName}...`);
          try {
            // Test authentication by making a lightweight API call
            logger.debug(`Getting connection provider for ${context.orgUrl}`);
            const connection = await context.connectionProvider();
            logger.debug(`Making API call to ${connection.serverUrl}/_apis/connectionData`);
            const response = await connection.rest.get(`${connection.serverUrl}/_apis/connectionData?api-version=7.0-preview`);

            if (response && response.result) {
              authStatus = "success";
              const userData = response.result as any;
              authDetails = `\nAuthenticated as: ${userData.authenticatedUser?.displayName || "Unknown"} (${userData.authenticatedUser?.uniqueName || "No email"})`;
              logger.info(`✅ Primary auth successful for ${context.orgName}: ${userData.authenticatedUser?.displayName}`);
            } else {
              authStatus = "failed";
              authDetails = "\nAuthentication test failed: No response data received";
              logger.warn(`❌ Primary auth failed for ${context.orgName}: No response data`);
            }
          } catch (authError) {
            authStatus = "failed";
            authDetails = `\nAuthentication failed: ${authError instanceof Error ? authError.message : "Unknown auth error"}`;
            logger.error(`❌ Primary auth failed for ${context.orgName}: ${authError instanceof Error ? authError.message : "Unknown error"}`);

            // Try interactive OAuth fallback
            logger.info(`🔄 Configured authentication failed for ${context.orgName}, attempting interactive OAuth fallback`);
            authDetails += `\n🔄 Attempting interactive OAuth fallback...`;

            try {
              // Create fresh interactive OAuth authenticator with target org's tenant
              logger.debug(`Creating OAuthAuthenticator with tenantId: ${context.tenantId || "undefined"}`);
              const interactiveAuth = new OAuthAuthenticator(context.tenantId);
              logger.debug(`Starting interactive token acquisition...`);
              const interactiveToken = await interactiveAuth.getToken();
              logger.info(`✅ Interactive OAuth token obtained (length: ${interactiveToken?.length || 0})`);

              // Test interactive auth by creating temporary connection
              const authHandler = getBearerHandler(interactiveToken);
              const testConnection = new WebApi(context.orgUrl, authHandler, undefined, {
                productName: "AzureDevOps.MCP",
                productVersion: packageVersion,
                userAgent: "AzureDevOps.MCP.Fallback",
              });
              const testResponse = await testConnection.rest.get(`${context.orgUrl}/_apis/connectionData?api-version=7.0-preview`);

              if (testResponse && testResponse.result) {
                authStatus = "interactive_success";
                const userData = testResponse.result as any;
                authDetails = `\n✅ Interactive OAuth authentication successful!`;
                authDetails += `\n👤 Authenticated as: ${userData.authenticatedUser?.displayName || "Unknown"} (${userData.authenticatedUser?.uniqueName || "No email"})`;
                authDetails += `\n💡 Different user authenticated - you can now access this organization`;

                logger.info(`✅ Interactive OAuth fallback successful for ${context.orgName}: ${userData.authenticatedUser?.displayName}`);

                // Update the organization context to use the new interactive authenticator
                logger.debug(`Creating new authenticator function for context update...`);
                const newAuthenticator = () => {
                  logger.debug(`New authenticator called, returning cached interactive token`);
                  return Promise.resolve(interactiveToken);
                };

                logger.debug(`Calling orgManager.updateContextAuthenticator(${context.id}, newAuthenticator)`);
                const updateSuccess = orgManager.updateContextAuthenticator(context.id, newAuthenticator);

                if (updateSuccess) {
                  authDetails += `\n🔄 Organization context updated to use new authentication`;
                  logger.info(`✅ Successfully updated context for ${context.orgName} with interactive auth`);

                  // Test the updated context by getting a fresh connection
                  logger.debug(`Testing updated context by getting fresh connection...`);
                  try {
                    const updatedContext = orgManager.getCurrentContext();
                    const testUpdatedConnection = await updatedContext?.connectionProvider();
                    logger.debug(`Testing updated connection with API call...`);
                    const verifyResponse = await testUpdatedConnection?.rest.get(`${testUpdatedConnection?.serverUrl}/_apis/connectionData?api-version=7.0-preview`);

                    if (verifyResponse && verifyResponse.result) {
                      logger.info(`✅ Updated context verification successful`);
                      authDetails += `\n✅ Updated context verified - subsequent tools will work`;
                    } else {
                      logger.warn(`⚠️  Updated context verification failed - no response data`);
                      authDetails += `\n⚠️  Context update may not have worked properly`;
                    }
                  } catch (verifyError) {
                    logger.error(`❌ Updated context verification failed: ${verifyError instanceof Error ? verifyError.message : "Unknown error"}`);
                    authDetails += `\n⚠️  Context verification failed: ${verifyError instanceof Error ? verifyError.message : "Unknown error"}`;
                  }
                } else {
                  authDetails += `\n⚠️  Authentication successful but failed to update organization context`;
                  logger.error(`❌ Failed to update context for ${context.orgName} with interactive auth`);
                }
              } else {
                authDetails += `\n❌ Interactive OAuth succeeded but test failed`;
              }
            } catch (interactiveError) {
              authDetails += `\n❌ Interactive OAuth fallback failed: ${interactiveError instanceof Error ? interactiveError.message : "Unknown error"}`;

              // Add helpful troubleshooting info
              authDetails += `\n\n🔧 Troubleshooting:`;
              authDetails += `\n   • Check if you have access to organization: ${context.orgName}`;
              authDetails += `\n   • Verify Azure CLI is logged in: az login`;
              authDetails += `\n   • Check tenant access: az account show`;
              authDetails += `\n   • Try manual auth: az devops login --organization ${context.orgUrl}`;

              if (authError instanceof Error && authError.message.includes("401")) {
                authDetails += `\n   • 401 Unauthorized: You may not have access to this organization`;
              } else if (authError instanceof Error && authError.message.includes("403")) {
                authDetails += `\n   • 403 Forbidden: Check organization permissions`;
              } else if (authError instanceof Error && authError.message.includes("timeout")) {
                authDetails += `\n   • Network timeout: Check connection and try again`;
              }
            }
          }
        }

        // Format success response
        let responseText = `✅ Switched to organization: ${context.id} (${context.orgName})`;
        responseText += `\n🌐 Organization URL: ${context.orgUrl}`;
        responseText += `\n🔧 Auth Type: ${context.id === organization ? "azcli" : "configured"}`;
        responseText += `\n📦 Enabled domains: ${Array.from(context.enabledDomains).join(", ")}`;

        if (!skipAuthTest) {
          responseText += `\n🔐 Authentication: ${authStatus}${authDetails}`;
        }

        return {
          content: [
            {
              type: "text",
              text: responseText,
            },
          ],
          isError: authStatus === "failed",
        };
      } catch (switchError) {
        return {
          content: [
            {
              type: "text",
              text: `❌ Failed to switch to organization '${organization}': ${switchError instanceof Error ? switchError.message : "Unknown error"}`,
            },
          ],
          isError: true,
        };
      }
    })
  );

  server.tool(
    "get_current_identity",
    "Get current user identity and organization context",
    {},
    withOrganizationContext(
      "get_current_identity",
      async () => {
        const context = orgManager.getCurrentContext()!;
        const connection = await context.connectionProvider();

        // Use the connection data API directly instead of coreApi
        const url = `${connection.serverUrl}/_apis/connectionData?api-version=7.0-preview`;
        const response = await connection.rest.get(url);

        if (!response || !response.result) {
          throw new Error("Failed to fetch connection data");
        }

        const connectionData = response.result;

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  organization: context.orgName,
                  organizationId: context.id,
                  organizationUrl: context.orgUrl,
                  user: connectionData,
                  tenantId: context.tenantId,
                  enabledDomains: Array.from(context.enabledDomains),
                },
                null,
                2
              ),
            },
          ],
        };
      },
      orgManager,
      Domain.CORE
    )
  );

  server.tool(
    "list_organizations",
    "List all available Azure DevOps organizations",
    {},
    withOrganizationManagement("list_organizations", async () => {
      const availableOrgs = orgManager.listOrganizations();
      const currentOrgId = orgManager.getCurrentOrganizationId();

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                currentOrganization: currentOrgId,
                availableOrganizations: availableOrgs,
              },
              null,
              2
            ),
          },
        ],
      };
    })
  );

  server.tool(
    "test_authentication",
    "Test authentication for the current organization without switching",
    {},
    withOrganizationContext(
      "test_authentication",
      async () => {
        const context = orgManager.getCurrentContext()!;

        try {
          // Test authentication by making a lightweight API call
          const connection = await context.connectionProvider();
          const response = await connection.rest.get(`${connection.serverUrl}/_apis/connectionData?api-version=7.0-preview`);

          if (response && response.result) {
            const userData = response.result as any;

            let responseText = `✅ Authentication successful for ${context.orgName}`;
            responseText += `\n👤 Authenticated as: ${userData.authenticatedUser?.displayName || "Unknown"}`;
            responseText += `\n📧 Email: ${userData.authenticatedUser?.uniqueName || "No email"}`;
            responseText += `\n🏢 Organization: ${context.orgName}`;
            responseText += `\n🌐 URL: ${context.orgUrl}`;
            responseText += `\n🆔 User ID: ${userData.authenticatedUser?.id || "Unknown"}`;

            if (userData.instanceType) {
              responseText += `\n🏷️  Instance Type: ${userData.instanceType}`;
            }

            return {
              content: [
                {
                  type: "text",
                  text: responseText,
                },
              ],
            };
          } else {
            return {
              content: [
                {
                  type: "text",
                  text: `❌ Authentication test failed for ${context.orgName}: No response data received`,
                },
              ],
              isError: true,
            };
          }
        } catch (authError) {
          let errorText = `❌ Authentication failed for ${context.orgName}`;
          errorText += `\n💥 Error: ${authError instanceof Error ? authError.message : "Unknown auth error"}`;
          errorText += `\n\n🔧 Troubleshooting steps:`;
          errorText += `\n   1. Check Azure CLI login status: az account show`;
          errorText += `\n   2. Re-login to Azure CLI: az login`;
          errorText += `\n   3. Verify organization access: az devops project list --organization ${context.orgUrl}`;
          errorText += `\n   4. Check if organization URL is correct: ${context.orgUrl}`;

          if (authError instanceof Error && authError.message.includes("401")) {
            errorText += `\n   5. 401 Unauthorized: You may not have access to this organization`;
          } else if (authError instanceof Error && authError.message.includes("403")) {
            errorText += `\n   5. 403 Forbidden: Check organization permissions or try: az devops login`;
          }

          return {
            content: [
              {
                type: "text",
                text: errorText,
              },
            ],
            isError: true,
          };
        }
      },
      orgManager,
      Domain.CORE
    )
  );

  server.tool(
    "refresh_authentication",
    "Refresh authentication for the current organization (forces re-authentication)",
    {
      force: z.boolean().optional().describe("Force authentication refresh even if current auth seems valid"),
    },
    withOrganizationContext(
      "refresh_authentication",
      async ({ force = false }) => {
        const context = orgManager.getCurrentContext()!;

        try {
          let responseText = `🔄 Refreshing authentication for ${context.orgName}...`;

          // First test current auth unless forcing refresh
          if (!force) {
            try {
              const connection = await context.connectionProvider();
              const testResponse = await connection.rest.get(`${connection.serverUrl}/_apis/connectionData?api-version=7.0-preview`);

              if (testResponse && testResponse.result) {
                responseText += `\n✅ Current authentication is still valid`;
                responseText += `\n💡 Use force=true to refresh anyway, or use test_authentication to check details`;

                return {
                  content: [
                    {
                      type: "text",
                      text: responseText,
                    },
                  ],
                };
              }
            } catch {
              // Current auth is invalid, proceed with refresh
              responseText += `\n🔍 Current authentication is invalid, proceeding with refresh...`;
            }
          }

          responseText += `\n\n🔧 To refresh authentication manually:`;
          responseText += `\n   1. Re-login to Azure CLI: az login`;
          responseText += `\n   2. Select correct tenant if needed: az login --tenant <tenant-id>`;
          responseText += `\n   3. Verify access: az devops project list --organization ${context.orgUrl}`;
          responseText += `\n   4. If still failing, try: az devops login --organization ${context.orgUrl}`;

          responseText += `\n\n🎯 After manual refresh, try using the organization tools again.`;
          responseText += `\n💡 Note: Automatic token refresh is handled by Azure CLI credential chain.`;

          return {
            content: [
              {
                type: "text",
                text: responseText,
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `❌ Failed to refresh authentication: ${error instanceof Error ? error.message : "Unknown error"}`,
              },
            ],
            isError: true,
          };
        }
      },
      orgManager,
      Domain.CORE
    )
  );
}

function configureAllTools(
  server: McpServer,
  tokenProvider: () => Promise<string>,
  connectionProvider: () => Promise<WebApi>,
  userAgentProvider: () => string,
  enabledDomains: Set<string>,
  orgManager: OrganizationManager
) {
  // Multi-org management tools (switch_organization, list_organizations, etc.) — registered
  // unconditionally so they're available regardless of which domains are enabled.
  configureOrgManagementTools(server, orgManager);

  const configureIfDomainEnabled = (domain: string, configureFn: () => void) => {
    if (enabledDomains.has(domain)) {
      configureFn();
    }
  };

  configureIfDomainEnabled(Domain.CORE, () => configureCoreTools(server, tokenProvider, connectionProvider, userAgentProvider));
  configureIfDomainEnabled(Domain.MCP_APPS, () => configureMcpAppsTools(server));
  configureIfDomainEnabled(Domain.WORK, () => configureWorkTools(server, tokenProvider, connectionProvider));
  configureIfDomainEnabled(Domain.PIPELINES, () => configurePipelineTools(server, tokenProvider, connectionProvider, userAgentProvider));
  configureIfDomainEnabled(Domain.REPOSITORIES, () => configureRepoTools(server, tokenProvider, connectionProvider, userAgentProvider));
  configureIfDomainEnabled(Domain.WORK_ITEMS, () => configureWorkItemTools(server, tokenProvider, connectionProvider, userAgentProvider));
  configureIfDomainEnabled(Domain.WIKI, () => configureWikiTools(server, tokenProvider, connectionProvider, userAgentProvider));
  configureIfDomainEnabled(Domain.TEST_PLANS, () => configureTestPlanTools(server, tokenProvider, connectionProvider, userAgentProvider));
  configureIfDomainEnabled(Domain.SEARCH, () => configureSearchTools(server, tokenProvider, connectionProvider, userAgentProvider));
  configureIfDomainEnabled(Domain.ADVANCED_SECURITY, () => configureAdvSecTools(server, tokenProvider, connectionProvider));
}

export { configureAllTools };
