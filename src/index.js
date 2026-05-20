#!/usr/bin/env node
/**
 * zylos-zalo
 *
 * Zalo Bot Platform communication channel for Vietnamese messaging
 */

import { getConfig, watchConfig, DATA_DIR } from './lib/config.js';

// Initialize
console.log(`[zalo] Starting...`);
console.log(`[zalo] Data directory: ${DATA_DIR}`);

// Load configuration
let config = getConfig();
console.log(`[zalo] Config loaded, enabled: ${config.enabled}`);

if (!config.enabled) {
  console.log(`[zalo] Component disabled in config, exiting.`);
  process.exit(0);
}

// Watch for config changes
watchConfig((newConfig) => {
  console.log(`[zalo] Config reloaded`);
  config = newConfig;
  if (!newConfig.enabled) {
    console.log(`[zalo] Component disabled, stopping...`);
    shutdown();
  }
});

// Main component logic
async function main() {
  // TODO: Implement your component logic here
  //
  // Communication components: set up platform SDK, listen for events, forward to C4
  // Capability components: start HTTP server or other service interface
  // Utility components: run task and exit (remove the keepalive below)

  console.log(`[zalo] Running`);
}

// Graceful shutdown
function shutdown() {
  console.log(`[zalo] Shutting down...`);
  // TODO: Close connections, stop listeners, cleanup
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Run
main().catch(err => {
  console.error(`[zalo] Fatal error:`, err);
  process.exit(1);
});
