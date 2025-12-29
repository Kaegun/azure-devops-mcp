// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { WebApi } from "azure-devops-node-api";
import { apiVersion } from "../utils.js";
import { IdentityBase } from "azure-devops-node-api/interfaces/IdentitiesInterfaces.js";

interface IdentitiesResponse {
  value: IdentityBase[];
}

async function getCurrentUserDetails(tokenProvider: () => Promise<string>, connectionProvider: () => Promise<WebApi>, userAgentProvider: () => string) {
  const connection = await connectionProvider();
  const url = `${connection.serverUrl}/_apis/connectionData`;
  const token = await tokenProvider();
  const response = await fetch(url, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": userAgentProvider(),
    },
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(`Error fetching user details: ${data.message}`);
  }
  return data;
}

/**
 * Searches for identities using Azure DevOps Identity API (legacy version with provider functions)
 */
async function searchIdentities(identity: string, tokenProvider: () => Promise<string>, connectionProvider: () => Promise<WebApi>, userAgentProvider: () => string): Promise<IdentitiesResponse> {
  const token = await tokenProvider();
  const connection = await connectionProvider();
  const orgName = connection.serverUrl.split("/")[3];
  const baseUrl = `https://vssps.dev.azure.com/${orgName}/_apis/identities`;

  const params = new URLSearchParams({
    "api-version": apiVersion,
    "searchFilter": "General",
    "filterValue": identity,
  });

  const response = await fetch(`${baseUrl}?${params}`, {
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": userAgentProvider(),
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HTTP ${response.status}: ${errorText}`);
  }

  return await response.json();
}

/**
 * Gets the user ID from email or unique name using Azure DevOps Identity API (legacy version)
 */
async function getUserIdFromEmail(userEmail: string, tokenProvider: () => Promise<string>, connectionProvider: () => Promise<WebApi>, userAgentProvider: () => string): Promise<string> {
  const identities = await searchIdentities(userEmail, tokenProvider, connectionProvider, userAgentProvider);

  if (!identities || identities.value?.length === 0) {
    throw new Error(`No user found with email/unique name: ${userEmail}`);
  }

  const firstIdentity = identities.value[0];
  if (!firstIdentity.id) {
    throw new Error(`No ID found for user with email/unique name: ${userEmail}`);
  }

  return firstIdentity.id;
}

/**
 * Context-aware version: Searches for identities using Azure DevOps Identity API
 * Simplified version that takes WebApi connection directly (for organization context)
 */
async function searchIdentitiesWithConnection(identity: string, connection: WebApi): Promise<IdentitiesResponse> {
  // Use the connection's built-in request capabilities instead of fetch
  const orgName = connection.serverUrl.split("/")[3];
  const baseUrl = `https://vssps.dev.azure.com/${orgName}/_apis/identities`;

  const params = new URLSearchParams({
    "api-version": apiVersion,
    "searchFilter": "General",
    "filterValue": identity,
  });

  const url = `${baseUrl}?${params}`;

  // Use connection's rest client to make authenticated request
  const response = await connection.rest.get(url);

  if (!response || !response.result) {
    throw new Error(`Failed to search identities`);
  }

  return response.result as IdentitiesResponse;
}

/**
 * Legacy version: Searches for identities using provider functions (for backward compatibility)
 */
async function searchIdentitiesLegacy(identity: string, tokenProvider: () => Promise<string>, connectionProvider: () => Promise<WebApi>, userAgentProvider: () => string): Promise<IdentitiesResponse> {
  const token = await tokenProvider();
  const connection = await connectionProvider();
  const orgName = connection.serverUrl.split("/")[3];
  const baseUrl = `https://vssps.dev.azure.com/${orgName}/_apis/identities`;

  const params = new URLSearchParams({
    "api-version": apiVersion,
    "searchFilter": "General",
    "filterValue": identity,
  });

  const response = await fetch(`${baseUrl}?${params}`, {
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": userAgentProvider(),
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HTTP ${response.status}: ${errorText}`);
  }

  return await response.json();
}

/**
 * Context-aware version: Gets the user ID from email or unique name
 */
async function getUserIdFromEmailWithConnection(userEmail: string, connection: WebApi): Promise<string> {
  const identities = await searchIdentitiesWithConnection(userEmail, connection);

  if (!identities || identities.value?.length === 0) {
    throw new Error(`No user found with email/unique name: ${userEmail}`);
  }

  const firstIdentity = identities.value[0];
  if (!firstIdentity.id) {
    throw new Error(`No ID found for user with email/unique name: ${userEmail}`);
  }

  return firstIdentity.id;
}

/**
 * Context-aware version: Gets current user details
 */
async function getCurrentUserDetailsWithConnection(connection: WebApi): Promise<any> {
  const url = `${connection.serverUrl}/_apis/connectionData`;

  // Use connection's rest client to make authenticated request
  const response = await connection.rest.get(url);

  if (!response || !response.result) {
    throw new Error(`Failed to fetch current user details`);
  }

  return response.result;
}

export {
  getCurrentUserDetails,
  getUserIdFromEmail,
  searchIdentities,
  // Legacy versions for backward compatibility
  searchIdentitiesLegacy,
  // Context-aware versions
  searchIdentitiesWithConnection,
  getUserIdFromEmailWithConnection,
  getCurrentUserDetailsWithConnection,
};
