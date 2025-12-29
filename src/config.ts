// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { readFile, access } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import { logger } from "./logger.js";

export interface AdoMcpConfig {
  organizations: Record<
    string,
    {
      orgName: string;
      authType?: string;
      domains?: string[];
    }
  >;
  defaultOrganization?: string;
}

export class ConfigManager {
  private static readonly CONFIG_FILE = join(homedir(), ".ado-mcp-orgs.json");

  /**
   * Load configuration from ~/.ado-mcp-orgs.json
   * Returns null if file doesn't exist or is invalid
   */
  static async loadConfig(): Promise<AdoMcpConfig | null> {
    logger.info(`ConfigManager: Attempting to load config from: ${this.CONFIG_FILE}`);
    logger.info(`ConfigManager: Process working directory: ${process.cwd()}`);
    logger.info(`ConfigManager: Process home directory: ${homedir()}`);
    logger.info(`ConfigManager: Process environment USER: ${process.env.USER || "undefined"}`);
    logger.info(`ConfigManager: Process environment HOME: ${process.env.HOME || "undefined"}`);

    try {
      // Check if file exists
      logger.debug(`ConfigManager: Checking if file exists: ${this.CONFIG_FILE}`);
      await access(this.CONFIG_FILE);
      logger.info(`ConfigManager: ✅ Config file exists at: ${this.CONFIG_FILE}`);

      // Read and parse file
      logger.debug(`ConfigManager: Reading config file contents...`);
      const configData = await readFile(this.CONFIG_FILE, "utf-8");
      logger.info(`ConfigManager: ✅ Config file read successfully, size: ${configData.length} bytes`);

      // Log the raw config data for debugging
      logger.info(`ConfigManager: Raw config file contents:`);
      logger.info(configData);

      logger.debug(`ConfigManager: Parsing JSON configuration...`);
      const config = JSON.parse(configData) as AdoMcpConfig;
      logger.info(`ConfigManager: ✅ JSON parsed successfully`);

      // Log the parsed configuration structure
      logger.info(`ConfigManager: Parsed configuration structure:`);
      logger.info(`  - Organizations count: ${Object.keys(config.organizations).length}`);
      logger.info(`  - Organization IDs: ${Object.keys(config.organizations).join(", ")}`);
      logger.info(`  - Default organization: ${config.defaultOrganization || "none set"}`);

      // Validate configuration
      logger.debug(`ConfigManager: Validating configuration...`);
      this.validateConfig(config);
      logger.info(`ConfigManager: ✅ Configuration validation passed`);

      logger.info(`ConfigManager: Successfully loaded config with ${Object.keys(config.organizations).length} organizations`);
      return config;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        logger.warn(`ConfigManager: ❌ Config file not found at ${this.CONFIG_FILE}`);
        logger.info(`ConfigManager: To create config file, create: ${this.CONFIG_FILE}`);
        logger.info(`ConfigManager: Example structure:`);
        logger.info(`{
  "organizations": {
    "1099": {
      "orgName": "1099Ventures",
      "authType": "azcli",
      "domains": ["core", "work", "repositories", "wiki"]
    }
  },
  "defaultOrganization": "1099"
}`);
        return null;
      }

      logger.error(`ConfigManager: ❌ Failed to load config file from ${this.CONFIG_FILE}:`, error);
      logger.error(`ConfigManager: Error type: ${error instanceof Error ? error.constructor.name : "Unknown"}`);
      logger.error(`ConfigManager: Error message: ${error instanceof Error ? error.message : "Unknown error"}`);

      if ((error as any).code) {
        logger.error(`ConfigManager: Error code: ${(error as any).code}`);
      }

      throw new Error(`Failed to load configuration: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  /**
   * Validate configuration structure and content
   */
  static validateConfig(config: AdoMcpConfig): void {
    if (!config || typeof config !== "object") {
      throw new Error("Configuration must be a valid JSON object");
    }

    if (!config.organizations || typeof config.organizations !== "object") {
      throw new Error('Configuration must contain an "organizations" object');
    }

    const orgIds = Object.keys(config.organizations);
    if (orgIds.length === 0) {
      throw new Error("Configuration must contain at least one organization");
    }

    // Validate each organization
    for (const [orgId, orgConfig] of Object.entries(config.organizations)) {
      this.validateOrganization(orgId, orgConfig);
    }

    // Validate defaultOrganization if specified
    if (config.defaultOrganization && !config.organizations[config.defaultOrganization]) {
      throw new Error(`Default organization '${config.defaultOrganization}' not found in organizations list`);
    }

    logger.debug(`ConfigManager: Configuration validation successful`);
  }

  /**
   * Validate individual organization configuration
   */
  private static validateOrganization(orgId: string, orgConfig: any): void {
    if (!orgId || typeof orgId !== "string" || orgId.trim().length === 0) {
      throw new Error("Organization ID must be a non-empty string");
    }

    if (!orgConfig || typeof orgConfig !== "object") {
      throw new Error(`Organization '${orgId}' must be an object`);
    }

    if (!orgConfig.orgName || typeof orgConfig.orgName !== "string" || orgConfig.orgName.trim().length === 0) {
      throw new Error(`Organization '${orgId}' must have a valid orgName`);
    }

    // Validate authType if provided
    if (orgConfig.authType !== undefined) {
      const validAuthTypes = ["interactive", "azcli", "env", "envvar"];
      if (typeof orgConfig.authType !== "string" || !validAuthTypes.includes(orgConfig.authType)) {
        throw new Error(`Organization '${orgId}' authType must be one of: ${validAuthTypes.join(", ")}`);
      }
    }

    // Validate domains if provided
    if (orgConfig.domains !== undefined) {
      if (!Array.isArray(orgConfig.domains)) {
        throw new Error(`Organization '${orgId}' domains must be an array`);
      }

      if (orgConfig.domains.length === 0) {
        throw new Error(`Organization '${orgId}' domains array cannot be empty`);
      }

      for (const domain of orgConfig.domains) {
        if (typeof domain !== "string" || domain.trim().length === 0) {
          throw new Error(`Organization '${orgId}' domains must contain non-empty strings`);
        }
      }
    }
  }

  /**
   * Check if configuration file exists
   */
  static async configExists(): Promise<boolean> {
    try {
      await access(this.CONFIG_FILE);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get the configuration file path
   */
  static getConfigPath(): string {
    return this.CONFIG_FILE;
  }
}
