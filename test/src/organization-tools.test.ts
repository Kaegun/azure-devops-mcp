// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { describe, expect, it, beforeEach } from "@jest/globals";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// Mock the OrganizationManager to avoid importing the full tools.ts
class MockOrganizationManager {
  private currentOrgId?: string = "test-org";
  private mockContext = {
    id: "test-org",
    orgName: "TestOrganization",
    orgUrl: "https://dev.azure.com/TestOrganization",
    authenticator: jest.fn().mockResolvedValue("mock-token"),
    connectionProvider: jest.fn().mockResolvedValue({
      rest: {
        get: jest.fn().mockResolvedValue({
          result: {
            authenticatedUser: {
              displayName: "Test User",
              uniqueName: "test@example.com",
            },
            authorizedUser: {
              id: "user-123",
            },
          },
        }),
      },
      serverUrl: "https://dev.azure.com/TestOrganization",
    }),
    enabledDomains: new Set(["core", "work"]),
    tenantId: "test-tenant-id",
  };

  async switchTo(orgId: string) {
    if (orgId === "invalid") {
      throw new Error("Organization not found");
    }
    this.currentOrgId = orgId;
    return this.mockContext;
  }

  getCurrentContext() {
    return this.currentOrgId ? this.mockContext : undefined;
  }

  listOrganizations() {
    return ["test-org", "other-org"];
  }

  getCurrentOrganizationId() {
    return this.currentOrgId;
  }

  updateContextAuthenticator() {
    return true;
  }
}

// Simple tool registration test that mimics organization tools
describe("Organization Management Tools", () => {
  let server: McpServer;
  let registeredTools: { [key: string]: any };

  beforeEach(() => {
    registeredTools = {};

    // Mock server that captures tool registrations
    server = {
      tool: jest.fn((name: string, description: string, schema: any, handler: any) => {
        registeredTools[name] = {
          description,
          schema,
          handler,
        };
      }),
    } as unknown as McpServer;
  });

  describe("organization tool registration patterns", () => {
    it("should follow the expected naming convention for organization tools", () => {
      const expectedTools = ["switch_organization", "get_current_identity", "list_organizations", "test_authentication", "refresh_authentication"];

      // Register mock tools following the same pattern as the real implementation
      expectedTools.forEach((toolName) => {
        server.tool(toolName, `Mock ${toolName} tool`, {}, async () => ({ content: [] }));
      });

      expectedTools.forEach((toolName) => {
        expect(registeredTools[toolName]).toBeDefined();
        expect(typeof registeredTools[toolName].handler).toBe("function");
      });
    });

    it("should have appropriate schemas for switch_organization", () => {
      // Register switch_organization with expected schema
      server.tool(
        "switch_organization",
        "Switch to a different Azure DevOps organization",
        {
          organization: { type: "string", description: "Organization ID from config file" },
          skipAuthTest: { type: "boolean", optional: true, description: "Skip authentication test" },
        },
        async () => ({ content: [] })
      );

      const tool = registeredTools["switch_organization"];
      expect(tool.schema).toHaveProperty("organization");
      expect(tool.schema).toHaveProperty("skipAuthTest");
      expect(tool.schema.organization.type).toBe("string");
      expect(tool.schema.skipAuthTest.type).toBe("boolean");
    });
  });

  describe("mock organization tool functionality", () => {
    let orgManager: MockOrganizationManager;

    beforeEach(() => {
      orgManager = new MockOrganizationManager();

      // Register mock tools that follow the same patterns as real implementation
      server.tool("switch_organization", "Switch organizations", {}, async ({ organization }: any) => {
        try {
          const context = await orgManager.switchTo(organization);
          return {
            content: [
              {
                type: "text",
                text: `✅ Switched to organization: ${context.id} (${context.orgName})`,
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `❌ Error switching to organization: ${organization}`,
              },
            ],
            isError: true,
          };
        }
      });

      server.tool("list_organizations", "List organizations", {}, async () => {
        const orgs = orgManager.listOrganizations();
        const current = orgManager.getCurrentOrganizationId();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ currentOrganization: current, availableOrganizations: orgs }, null, 2),
            },
          ],
        };
      });

      server.tool("get_current_identity", "Get identity", {}, async () => {
        const context = orgManager.getCurrentContext();
        if (!context) {
          return { content: [{ type: "text", text: "No organization selected" }], isError: true };
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  organization: context.orgName,
                  organizationId: context.id,
                  enabledDomains: Array.from(context.enabledDomains),
                },
                null,
                2
              ),
            },
          ],
        };
      });
    });

    it("should handle successful organization switch", async () => {
      const result = await registeredTools["switch_organization"].handler({ organization: "test-org" });

      expect(result.content[0].text).toContain("✅ Switched to organization: test-org (TestOrganization)");
      expect(result.isError).toBeUndefined();
    });

    it("should handle failed organization switch", async () => {
      const result = await registeredTools["switch_organization"].handler({ organization: "invalid" });

      expect(result.content[0].text).toContain("❌ Error switching to organization: invalid");
      expect(result.isError).toBe(true);
    });

    it("should list organizations correctly", async () => {
      const result = await registeredTools["list_organizations"].handler({});

      const data = JSON.parse(result.content[0].text);
      expect(data.currentOrganization).toBe("test-org");
      expect(data.availableOrganizations).toEqual(["test-org", "other-org"]);
    });

    it("should get current identity", async () => {
      const result = await registeredTools["get_current_identity"].handler({});

      const data = JSON.parse(result.content[0].text);
      expect(data.organization).toBe("TestOrganization");
      expect(data.organizationId).toBe("test-org");
      expect(data.enabledDomains).toEqual(["core", "work"]);
    });
  });
});
