// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { OrganizationManager } from "./organization-context.js";
import { logger } from "./logger.js";

type ToolHandler = (params: any) => Promise<any>;

/**
 * Wraps a tool handler with organization context validation and domain checking
 */
export function withOrganizationContext(toolName: string, handler: ToolHandler, orgManager: OrganizationManager, requiredDomain: string): ToolHandler {
  return async (params: any) => {
    logger.debug(`ToolWrapper: Executing tool '${toolName}' with organization context validation`);

    try {
      // Check if an organization is selected
      const context = orgManager.getCurrentContext();
      if (!context) {
        logger.warn(`ToolWrapper: Tool '${toolName}' called without organization context`);
        return {
          content: [
            {
              type: "text",
              text: `No organization selected. Use 'switch_organization' tool to select an organization first.\n\nAvailable organizations: ${orgManager.listOrganizations().join(", ")}`,
            },
          ],
          isError: true,
        };
      }

      // Check if the required domain is enabled for the current organization
      if (!context.enabledDomains.has(requiredDomain)) {
        const enabledDomains = Array.from(context.enabledDomains).join(", ");
        logger.warn(`ToolWrapper: Tool '${toolName}' requires domain '${requiredDomain}' but organization '${context.id}' only has: ${enabledDomains}`);
        return {
          content: [
            {
              type: "text",
              text: `Domain '${requiredDomain}' is not enabled for organization '${context.id}' (${context.orgName}).\n\nEnabled domains: ${enabledDomains}\n\nTo enable this domain, update your configuration file or use a different organization.`,
            },
          ],
          isError: true,
        };
      }

      logger.debug(`ToolWrapper: Context validation passed for tool '${toolName}' on organization '${context.id}'`);

      // Execute the actual tool handler
      const result = await handler(params);

      logger.debug(`ToolWrapper: Tool '${toolName}' completed successfully`);
      return result;
    } catch (error) {
      logger.error(`ToolWrapper: Tool '${toolName}' failed:`, error);

      // Ensure we always return a properly formatted error response
      const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
      return {
        content: [
          {
            type: "text",
            text: `Error executing tool '${toolName}': ${errorMessage}`,
          },
        ],
        isError: true,
      };
    }
  };
}

/**
 * Special wrapper for organization management tools that don't require domain validation
 */
export function withOrganizationManagement(toolName: string, handler: ToolHandler): ToolHandler {
  return async (params: any) => {
    logger.debug(`ToolWrapper: Executing organization management tool '${toolName}'`);

    try {
      const result = await handler(params);
      logger.debug(`ToolWrapper: Organization management tool '${toolName}' completed successfully`);
      return result;
    } catch (error) {
      logger.error(`ToolWrapper: Organization management tool '${toolName}' failed:`, error);

      const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
      return {
        content: [
          {
            type: "text",
            text: `Error executing '${toolName}': ${errorMessage}`,
          },
        ],
        isError: true,
      };
    }
  };
}
