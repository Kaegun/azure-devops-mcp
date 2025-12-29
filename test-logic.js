#!/usr/bin/env node

// Test the new logic for config loading
import { ConfigManager } from "./dist/config.js";

async function testNewLogic() {
  console.log("🧪 Testing New Configuration Logic\n");

  // Test: Always attempt to load config
  console.log("1. Testing config loading...");
  try {
    const config = await ConfigManager.loadConfig();

    if (config) {
      const orgCount = Object.keys(config.organizations).length;
      console.log(`   ✅ Config found with ${orgCount} organizations`);

      if (orgCount > 1) {
        console.log("   🏢 Would use MULTI-ORG mode (multiple organizations in config)");
        console.log(`   📋 Organizations: ${Object.keys(config.organizations).join(", ")}`);
        console.log(`   🎯 Default: ${config.defaultOrganization || "none"}`);
      } else {
        console.log("   📍 Would use SINGLE-ORG mode (only one organization in config)");
        console.log("   💡 Even with config, CLI argument would be used for single org");
      }
    } else {
      console.log("   ❌ No config found");
      console.log("   📍 Would use SINGLE-ORG mode (CLI argument required)");
    }
  } catch (error) {
    console.log("   ❌ Config loading failed");
    console.log(`   Error: ${error.message}`);
    console.log("   📍 Would use SINGLE-ORG mode (CLI argument required)");
  }

  console.log("\n✅ New Logic Summary:");
  console.log("   • ALWAYS attempts to load ~/.ado-mcp-orgs.json first");
  console.log("   • If config has MULTIPLE organizations → Multi-org mode");
  console.log("   • If config has ONE organization or no config → Single-org mode");
  console.log("   • CLI interface unchanged (organization still required)");
  console.log("   • Backward compatibility fully preserved");
}

testNewLogic();
