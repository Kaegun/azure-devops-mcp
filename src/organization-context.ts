// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { getBearerHandler, WebApi } from "azure-devops-node-api";
import { UserAgentComposer } from "./useragent.js";
import { createAuthenticator } from "./auth.js";
import { getOrgTenant } from "./org-tenants.js";
import { DomainsManager } from "./shared/domains.js";
import { packageVersion } from "./version.js";
import { logger } from "./logger.js";

export interface OrganizationConfig {
  id: string; // Short identifier (e.g., "1099", "cei")
  orgName: string; // Full ADO organization name (e.g., "1099Ventures")
  authType: string; // "azcli", "interactive", "env", "envvar"
  tenantId?: string; // Optional explicit tenant ID
  domains: string[]; // Enabled domains for this org
}

export interface OrganizationContext {
  id: string;
  orgName: string;
  orgUrl: string;
  authenticator: () => Promise<string>;
  connectionProvider: () => Promise<WebApi>;
  enabledDomains: Set<string>;
  tenantId?: string;
}

export class OrganizationManager {
  private contexts = new Map<string, OrganizationContext>();
  private currentOrgId?: string;
  private userAgentComposer: UserAgentComposer;

  constructor(userAgentComposer: UserAgentComposer) {
    this.userAgentComposer = userAgentComposer;
  }

  /**
   * Add an organization to the manager
   */
  async addOrganization(config: OrganizationConfig): Promise<void> {
    logger.debug(`OrganizationManager: Adding organization '${config.id}' (${config.orgName})`);

    try {
      const context = await this.createContext(config);
      this.contexts.set(config.id, context);
      logger.debug(`OrganizationManager: Successfully added organization '${config.id}'`);
    } catch (error) {
      logger.error(`OrganizationManager: Failed to add organization '${config.id}':`, error);
      throw new Error(`Failed to add organization '${config.id}': ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  /**
   * Switch to a different organization
   */
  async switchTo(orgId: string): Promise<OrganizationContext> {
    logger.debug(`OrganizationManager: Switching to organization '${orgId}'`);

    const context = this.contexts.get(orgId);
    if (!context) {
      const availableOrgs = Array.from(this.contexts.keys());
      throw new Error(`Organization '${orgId}' not found. Available organizations: ${availableOrgs.join(", ")}`);
    }

    this.currentOrgId = orgId;
    logger.info(`OrganizationManager: Switched to organization '${orgId}' (${context.orgName})`);
    return context;
  }

  /**
   * Get the current organization context
   */
  getCurrentContext(): OrganizationContext | undefined {
    if (!this.currentOrgId) {
      return undefined;
    }
    return this.contexts.get(this.currentOrgId);
  }

  /**
   * List all available organizations
   */
  listOrganizations(): string[] {
    return Array.from(this.contexts.keys());
  }

  /**
   * Check if an organization exists
   */
  hasOrganization(orgId: string): boolean {
    return this.contexts.has(orgId);
  }

  /**
   * Get the current organization ID
   */
  getCurrentOrganizationId(): string | undefined {
    return this.currentOrgId;
  }

  /**
   * Update the authenticator for an existing organization context
   */
  updateContextAuthenticator(orgId: string, newAuthenticator: () => Promise<string>): boolean {
    logger.debug(`OrganizationManager: Updating authenticator for organization '${orgId}'`);

    const existingContext = this.contexts.get(orgId);
    if (!existingContext) {
      logger.error(`OrganizationManager: Cannot update authenticator - organization '${orgId}' not found`);
      return false;
    }

    try {
      // Create new connection provider with updated authenticator
      const newConnectionProvider = this.createConnectionProvider(existingContext.orgUrl, newAuthenticator);

      // Update the context with new authenticator and connection provider
      const updatedContext: OrganizationContext = {
        ...existingContext,
        authenticator: newAuthenticator,
        connectionProvider: newConnectionProvider,
      };

      // Store the updated context
      this.contexts.set(orgId, updatedContext);

      logger.debug(`OrganizationManager: Successfully updated authenticator for organization '${orgId}'`);
      return true;
    } catch (error) {
      logger.error(`OrganizationManager: Failed to update authenticator for organization '${orgId}':`, error);
      return false;
    }
  }

  /**
   * Create organization context using existing auth/tenant infrastructure
   */
  private async createContext(config: OrganizationConfig): Promise<OrganizationContext> {
    logger.debug(`OrganizationManager: Creating context for organization '${config.id}' (${config.orgName})`);

    // Resolve tenant ID - use explicit tenant or discover from org name
    const discoveredTenantId = await getOrgTenant(config.orgName);
    const tenantId = config.tenantId || discoveredTenantId;
    logger.debug(`OrganizationManager: Tenant ID for '${config.orgName}': ${tenantId || "undefined"}`);

    // Create authenticator using existing infrastructure
    const authenticator = createAuthenticator(config.authType, tenantId);

    // Create organization URL
    const orgUrl = `https://dev.azure.com/${config.orgName}`;

    // Process domains configuration
    const domainsManager = new DomainsManager(config.domains);
    const enabledDomains = domainsManager.getEnabledDomains();

    // Create connection provider factory
    const connectionProvider = this.createConnectionProvider(orgUrl, authenticator);

    return {
      id: config.id,
      orgName: config.orgName,
      orgUrl,
      authenticator,
      connectionProvider,
      enabledDomains,
      tenantId,
    };
  }

  /**
   * Create a connection provider factory for an organization
   */
  private createConnectionProvider(orgUrl: string, authenticator: () => Promise<string>): () => Promise<WebApi> {
    return async () => {
      logger.debug(`OrganizationManager: Creating WebApi connection for ${orgUrl}`);

      const accessToken = await authenticator();
      const authHandler = getBearerHandler(accessToken);

      const connection = new WebApi(orgUrl, authHandler, undefined, {
        productName: "AzureDevOps.MCP",
        productVersion: packageVersion,
        userAgent: this.userAgentComposer.userAgent,
      });

      logger.debug(`OrganizationManager: Successfully created WebApi connection for ${orgUrl}`);
      return connection;
    };
  }
}
