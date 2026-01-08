# Multi-Organization Support

This guide explains how to use the Azure DevOps MCP Server with multiple organizations.

## Overview

The Azure DevOps MCP Server supports two operating modes:

### Single-Organization Mode (Default)

- Traditional mode where the server connects to one Azure DevOps organization
- Organization specified via command-line argument
- No configuration file required
- Ideal for users working with a single organization

### Multi-Organization Mode

- Connect to multiple Azure DevOps organizations from a single MCP server instance
- Switch between organizations dynamically without restarting
- Organization configuration stored in `~/.ado-mcp-orgs.json`
- Reduces Claude context window usage (one set of tool definitions instead of multiple)

## When to Use Multi-Organization Mode

Use multi-organization mode if you:

- Work with multiple Azure DevOps organizations regularly
- Want to reduce MCP server instances in Claude Desktop/Code
- Need to switch between organizations frequently
- Want a single interface for all your Azure DevOps work

## Configuration File

### Location

The configuration file must be located at:

```
~/.ado-mcp-orgs.json
```

On Windows: `C:\Users\<username>\.ado-mcp-orgs.json`
On Linux/WSL: `/home/<username>/.ado-mcp-orgs.json`
On macOS: `/Users/<username>/.ado-mcp-orgs.json`

### Format

```json
{
  "organizations": {
    "org-id-1": {
      "orgName": "YourOrgName",
      "authType": "azcli",
      "tenantId": "optional-tenant-id",
      "domains": ["core", "work", "pipelines"]
    },
    "org-id-2": {
      "orgName": "AnotherOrg",
      "authType": "interactive",
      "tenantId": "optional-tenant-id",
      "domains": ["core", "repositories"]
    }
  },
  "defaultOrganization": "org-id-1"
}
```

### Configuration Fields

#### Organization ID (Key)

- Short identifier for the organization (e.g., "mycompany", "project1")
- Used when switching between organizations
- Can be any alphanumeric string

#### `orgName` (Required)

- The actual Azure DevOps organization name
- Appears in the URL: `https://dev.azure.com/<orgName>`

#### `authType` (Required)

- Authentication method to use
- Options:
  - `"azcli"` - Use Azure CLI credentials (recommended for most cases)
  - `"interactive"` - Use interactive OAuth flow (for cross-tenant access)

#### `tenantId` (Optional)

- Azure AD tenant ID for the organization
- Required when using `interactive` auth type
- Optional for `azcli` auth type

#### `domains` (Required)

- Array of Azure DevOps domains to enable
- See [TOOLSET.md](./docs/TOOLSET.md) for the available domains.

#### `defaultOrganization` (Optional)

- Organization ID to auto-select on server startup
- If not specified, server starts without an active organization
- User must call `switch_organization` before using other tools

## Mode Detection

The server automatically detects which mode to use:

1. **Multi-Organization Mode** - Used when:
   - `~/.ado-mcp-orgs.json` exists
   - File contains multiple organizations
   - Command-line organization argument is ignored

2. **Single-Organization Mode** - Used when:
   - No config file exists, OR
   - Config file contains only one organization
   - Uses command-line argument for organization name

## Example Configurations

### Basic Multi-Organization Setup

```json
{
  "organizations": {
    "work": {
      "orgName": "MyCompany",
      "authType": "azcli",
      "domains": ["core", "work", "work-items", "repositories"]
    },
    "personal": {
      "orgName": "PersonalProjects",
      "authType": "azcli",
      "domains": ["core", "repositories", "pipelines"]
    }
  },
  "defaultOrganization": "work"
}
```

### Multi-Tenant Configuration

```json
{
  "organizations": {
    "company-a": {
      "orgName": "CompanyA",
      "authType": "azcli",
      "domains": ["core", "work"]
    },
    "client-b": {
      "orgName": "ClientB",
      "authType": "interactive",
      "tenantId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
      "domains": ["core", "repositories"]
    }
  },
  "defaultOrganization": "company-a"
}
```

## Organization Management Tools

When running in multi-organization mode, the following tools become available:

### `switch_organization`

Switch the active organization.

**Parameters:**

- `organization` (required) - Organization ID from config file
- `skipAuthTest` (optional) - Skip authentication validation for faster switching

**Example:**

```json
{
  "organization": "work",
  "skipAuthTest": false
}
```

### `list_organizations`

List all configured organizations and show which is currently active.

**Example Response:**

```json
{
  "currentOrganization": "work",
  "availableOrganizations": ["work", "personal", "client"],
  "organizationsList": "→ work (MyCompany)\n  personal (PersonalProjects)\n  client (ClientOrg)"
}
```

### `get_current_identity`

Get information about the current user and active organization.

**Example Response:**

```json
{
  "organization": "MyCompany",
  "organizationId": "work",
  "organizationUrl": "https://dev.azure.com/MyCompany",
  "user": {
    "displayName": "John Doe",
    "uniqueName": "john@example.com"
  },
  "tenantId": "...",
  "enabledDomains": ["core", "work", "repositories"]
}
```

### `test_authentication`

Test if authentication is working for the current organization.

### `refresh_authentication`

Attempt to refresh authentication tokens for the current organization.

## Command Line Usage

### Single-Organization Mode

```bash
mcp-server-azuredevops MyOrgName -d core work pipelines
```

### Multi-Organization Mode

```bash
# Organization argument is ignored, config file is used
mcp-server-azuredevops placeholder -d core
```

**Note:** In multi-organization mode, the command-line organization argument is still required for backwards compatibility but will be ignored in favor of the config file.

## Authentication Methods

### Azure CLI (`azcli`)

- Uses credentials from `az login`
- Works well for organizations in your default tenant
- Most reliable for regular use
- **Recommended for most users**

**Setup:**

```bash
az login
az account show  # Verify correct tenant
```

### Interactive OAuth (`interactive`)

- Opens browser for authentication
- Required for cross-tenant access
- Useful when accessing organizations in different Azure AD tenants
- May prompt for credentials each time

## Troubleshooting

### Server Doesn't Detect Config File

- Verify file location: `~/.ado-mcp-orgs.json`
- Check file permissions (must be readable)
- Validate JSON syntax using a JSON validator
- Check server logs for config loading messages

### Authentication Failures

- For `azcli`: Run `az login` and ensure correct tenant
- For `interactive`: Verify `tenantId` is correct
- Check organization access in Azure Portal
- Use `test_authentication` tool to diagnose

### Organization Switch Fails

- Verify organization ID exists in config
- Check that authentication works for target organization
- Review enabled domains for the organization
- Check server logs for detailed error messages

## Migration from Single to Multi-Organization

1. **Create the config file** at `~/.ado-mcp-orgs.json`
2. **Add your organizations** with appropriate settings
3. **Restart the MCP server** (Claude Desktop/Code)
4. **Use `list_organizations`** to verify configuration
5. **Use `switch_organization`** to select active organization

**Note:** You can keep single-organization mode by either:

- Not creating a config file, OR
- Creating a config file with only one organization

## Best Practices

1. **Use descriptive organization IDs** - Makes switching easier
2. **Set a default organization** - Server ready immediately on startup
3. **Enable only needed domains** - Reduces tool clutter and improves performance
4. **Use `azcli` when possible** - More reliable than interactive auth
5. **Document your config** - Keep a backup or notes about your setup
6. **Test authentication** - Use `test_authentication` after setup

## Security Considerations

- Config file may contain tenant IDs (consider permissions)
- Authentication tokens are managed by Azure CLI or OAuth
- No passwords or secrets are stored in the config file
- Config file should have restricted permissions (owner read/write only)

**Recommended file permissions:**

```bash
chmod 600 ~/.ado-mcp-orgs.json
```
