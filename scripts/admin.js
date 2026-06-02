#!/usr/bin/env node
/**
 * zylos-zalo admin CLI
 * Manage Zalo bot configuration
 *
 * Usage: node admin.js <command> [args]
 */

import { loadConfig, saveConfig } from '../src/lib/config.js';

const commands = {
  show: () => {
    const config = loadConfig();
    const safe = { ...config };
    if (safe.botToken) safe.botToken = safe.botToken.substring(0, 8) + '...';
    if (safe.webhookSecret) safe.webhookSecret = safe.webhookSecret.substring(0, 4) + '...';
    console.log(JSON.stringify(safe, null, 2));
  },

  'set-dm-policy': (policy) => {
    const valid = ['open', 'allowlist', 'owner'];
    policy = String(policy || '').trim().toLowerCase();
    if (!valid.includes(policy)) {
      console.error(`Usage: admin.js set-dm-policy <${valid.join('|')}>`);
      process.exit(1);
    }
    const config = loadConfig();
    config.dmPolicy = policy;
    if (!saveConfig(config)) {
      console.error('[zalo] Failed to save config');
      process.exit(1);
    }
    const desc = { open: 'Anyone can DM', allowlist: 'Only dmAllowFrom users can DM', owner: 'Only owner can DM' };
    console.log(`DM policy set to: ${policy} (${desc[policy]})`);
    console.log('Run: pm2 restart zylos-zalo');
  },

  'list-dm-allow': () => {
    const config = loadConfig();
    console.log(`DM policy: ${config.dmPolicy || 'owner'}`);
    const allowFrom = config.dmAllowFrom || [];
    console.log(`DM allowFrom (${allowFrom.length}):`, allowFrom.length ? allowFrom.join(', ') : 'none');
  },

  'add-dm-allow': (userId) => {
    if (!userId) {
      console.error('Usage: admin.js add-dm-allow <user_id>');
      process.exit(1);
    }
    const config = loadConfig();
    if (!Array.isArray(config.dmAllowFrom)) config.dmAllowFrom = [];
    if (!config.dmAllowFrom.includes(userId)) {
      config.dmAllowFrom.push(userId);
      if (!saveConfig(config)) {
        console.error('[zalo] Failed to save config');
        process.exit(1);
      }
      console.log(`Added ${userId} to dmAllowFrom`);
    } else {
      console.log(`${userId} already in dmAllowFrom`);
    }
    if ((config.dmPolicy || 'owner') !== 'allowlist') {
      console.log(`Note: dmPolicy is "${config.dmPolicy || 'owner'}", set to "allowlist" for this to take effect.`);
    }
    console.log('Run: pm2 restart zylos-zalo');
  },

  'remove-dm-allow': (userId) => {
    if (!userId) {
      console.error('Usage: admin.js remove-dm-allow <user_id>');
      process.exit(1);
    }
    const config = loadConfig();
    if (!Array.isArray(config.dmAllowFrom)) {
      console.log(`${userId} not found in dmAllowFrom`);
      return;
    }
    const idx = config.dmAllowFrom.indexOf(userId);
    if (idx >= 0) {
      config.dmAllowFrom.splice(idx, 1);
      if (!saveConfig(config)) {
        console.error('[zalo] Failed to save config');
        process.exit(1);
      }
      console.log(`Removed ${userId} from dmAllowFrom`);
    } else {
      console.log(`${userId} not found in dmAllowFrom`);
    }
  },

  'set-dm-welcome': (...parts) => {
    const message = parts.join(' ').trim();
    if (!message) {
      console.error('Usage: admin.js set-dm-welcome <message>');
      process.exit(1);
    }
    const config = loadConfig();
    config.dmWelcomeMessage = message;
    if (!saveConfig(config)) {
      console.error('[zalo] Failed to save config');
      process.exit(1);
    }
    console.log('DM welcome message updated');
    console.log('Run: pm2 restart zylos-zalo');
  },

  'show-dm-welcome': () => {
    const config = loadConfig();
    const message = config.dmWelcomeMessage || '';
    console.log(message || '(disabled)');
  },

  'show-owner': () => {
    const config = loadConfig();
    const owner = config.owner || {};
    if (owner.user_id) {
      console.log(`Owner: ${owner.name || 'unknown'} (${owner.user_id})`);
      console.log(`Bound at: ${owner.bound_at || 'unknown'}`);
    } else {
      console.log('No owner configured');
    }
  },

  'set-delivery': (mode) => {
    const valid = ['polling', 'webhook'];
    mode = String(mode || '').trim().toLowerCase();
    if (!valid.includes(mode)) {
      console.error(`Usage: admin.js set-delivery <${valid.join('|')}>`);
      process.exit(1);
    }
    const config = loadConfig();
    config.delivery = mode;
    if (!saveConfig(config)) {
      console.error('[zalo] Failed to save config');
      process.exit(1);
    }
    console.log(`Delivery mode set to: ${mode}`);
    console.log('Run: pm2 restart zylos-zalo');
  },

  help: () => {
    console.log(`
zylos-zalo admin CLI

Commands:
  show                                   Show config (token masked)

  DM Access Control:
  set-dm-policy <open|allowlist|owner>   Set DM policy
  list-dm-allow                          Show DM policy and allowFrom list
  add-dm-allow <user_id>                 Add user to dmAllowFrom
  remove-dm-allow <user_id>              Remove user from dmAllowFrom
  set-dm-welcome <message>               Set first-contact DM welcome message
  show-dm-welcome                        Show first-contact DM welcome message

  Bot Settings:
  set-delivery <polling|webhook>         Set message delivery mode
  show-owner                             Show current owner

  help                                   Show this help

Permission flow:
  DM: dmPolicy (open|allowlist|owner) + dmAllowFrom
  Group: groupPolicy (open|allowlist|disabled) + per-group allowFrom
  Owner bypasses allowlist checks only. groupPolicy: disabled blocks
  all group messages, including from owner.

After changes, restart bot: pm2 restart zylos-zalo
`);
  }
};

const args = process.argv.slice(2);
const command = args[0] || 'help';

if (commands[command]) {
  commands[command](...args.slice(1));
} else {
  console.error(`Unknown command: ${command}`);
  commands.help();
  process.exit(1);
}
