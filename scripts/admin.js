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
    const valid = ['open', 'allowlist', 'owner', 'pairing'];
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
    const desc = {
      open: 'Anyone can DM',
      allowlist: 'Only dmAllowFrom users can DM',
      owner: 'Only owner can DM',
      pairing: 'Unknown senders request access; owner approves/denies'
    };
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

  'clear-dm-welcome': () => {
    const config = loadConfig();
    config.dmWelcomeMessage = '';
    if (!saveConfig(config)) {
      console.error('[zalo] Failed to save config');
      process.exit(1);
    }
    console.log('DM welcome message disabled');
    console.log('Run: pm2 restart zylos-zalo');
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

  'dm-pending': async () => {
    const { listPending } = await import('../src/lib/dm-pairing.js');
    const pending = listPending();
    if (!pending.length) {
      console.log('No pending DM access requests.');
      return;
    }
    console.log(`Pending DM access requests (${pending.length}):`);
    for (const p of pending) {
      console.log(`  ${p.name || 'unknown'} (${p.user_id}) — requested ${p.requested_at}`);
      if (p.first_message) console.log(`    first message: ${p.first_message}`);
    }
  },

  'dm-approve': async (userId) => {
    if (!userId) {
      console.error('Usage: admin.js dm-approve <user_id>');
      process.exit(1);
    }
    const { loadPairingState, savePairingState, approvePairingUser } = await import('../src/lib/dm-pairing.js');
    const config = loadConfig();
    const state = loadPairingState();
    approvePairingUser(config, userId, state);
    if (!saveConfig(config)) {
      console.error('[zalo] Failed to save config');
      process.exit(1);
    }
    savePairingState(state);
    console.log(`Approved ${userId} — added to dmAllowFrom. They can now DM the bot.`);
    console.log('Run: pm2 restart zylos-zalo');
  },

  'dm-deny': async (userId, ...reasonParts) => {
    if (!userId) {
      console.error('Usage: admin.js dm-deny <user_id> [reason]');
      process.exit(1);
    }
    const { loadPairingState, savePairingState, denyPairingUser } = await import('../src/lib/dm-pairing.js');
    const config = loadConfig();
    const state = loadPairingState();
    denyPairingUser(config, userId, reasonParts.join(' '), state);
    if (!saveConfig(config)) {
      console.error('[zalo] Failed to save config');
      process.exit(1);
    }
    savePairingState(state);
    console.log(`Denied ${userId} — recorded as denied and removed from dmAllowFrom.`);
    console.log('Run: pm2 restart zylos-zalo');
  },

  'set-group-policy': (policy) => {
    const valid = ['open', 'allowlist', 'disabled'];
    policy = String(policy || '').trim().toLowerCase();
    if (!valid.includes(policy)) {
      console.error(`Usage: admin.js set-group-policy <${valid.join('|')}>`);
      process.exit(1);
    }
    const config = loadConfig();
    config.groupPolicy = policy;
    if (!saveConfig(config)) {
      console.error('[zalo] Failed to save config');
      process.exit(1);
    }
    const desc = {
      open: 'All groups allowed',
      allowlist: 'Only configured groups allowed',
      disabled: 'No group messages (including owner)'
    };
    console.log(`Group policy set to: ${policy} (${desc[policy]})`);
    console.log('Run: pm2 restart zylos-zalo');
  },

  'list-groups': () => {
    const config = loadConfig();
    console.log(`Group policy: ${config.groupPolicy || 'allowlist'}`);
    const groups = config.groups || {};
    const ids = Object.keys(groups);
    if (!ids.length) {
      console.log('Configured groups (0): none');
      return;
    }
    console.log(`Configured groups (${ids.length}):`);
    const defaultLimit = config.message?.context_messages || 5;
    for (const id of ids) {
      const g = groups[id] || {};
      const allowFrom = Array.isArray(g.allowFrom) ? g.allowFrom : [];
      const senders = (allowFrom.length === 0 || allowFrom.includes('*')) ? 'anyone' : allowFrom.join(', ');
      console.log(`  ${g.name || '(unnamed)'} (${id}) — allowFrom: ${senders}; historyLimit: ${g.historyLimit ?? defaultLimit}`);
    }
  },

  'add-group': (chatId, ...nameParts) => {
    chatId = String(chatId || '').trim();
    const name = nameParts.join(' ').trim();
    if (!chatId || !name) {
      console.error('Usage: admin.js add-group <chat_id> <name>');
      process.exit(1);
    }
    const config = loadConfig();
    if (!config.groups) config.groups = {};
    if (config.groups[chatId]) {
      console.log(`Group ${chatId} already configured: ${config.groups[chatId].name}`);
      return;
    }
    config.groups[chatId] = {
      name,
      allowFrom: ['*'],
      historyLimit: config.message?.context_messages || 5,
      added_at: new Date().toISOString()
    };
    if (!saveConfig(config)) {
      console.error('[zalo] Failed to save config');
      process.exit(1);
    }
    console.log(`Added group: ${name} (${chatId}) — allowFrom: anyone`);
    if ((config.groupPolicy || 'allowlist') !== 'allowlist') {
      console.log(`Note: groupPolicy is "${config.groupPolicy}"; set to "allowlist" for per-group config to gate access.`);
    }
    console.log('Run: pm2 restart zylos-zalo');
  },

  'remove-group': (chatId) => {
    chatId = String(chatId || '').trim();
    if (!chatId) {
      console.error('Usage: admin.js remove-group <chat_id>');
      process.exit(1);
    }
    const config = loadConfig();
    if (!config.groups || !config.groups[chatId]) {
      console.log(`Group ${chatId} not found`);
      return;
    }
    const name = config.groups[chatId].name;
    delete config.groups[chatId];
    if (!saveConfig(config)) {
      console.error('[zalo] Failed to save config');
      process.exit(1);
    }
    console.log(`Removed group: ${name || '(unnamed)'} (${chatId})`);
    console.log('Run: pm2 restart zylos-zalo');
  },

  'set-group-allowfrom': (chatId, value) => {
    chatId = String(chatId || '').trim();
    value = String(value || '').trim();
    if (!chatId || !value) {
      console.error('Usage: admin.js set-group-allowfrom <chat_id> <id1,id2,...|*>');
      console.error('  Use "*" to allow all members; a comma-separated list to restrict senders.');
      process.exit(1);
    }
    const config = loadConfig();
    if (!config.groups || !config.groups[chatId]) {
      console.error(`Group ${chatId} not found. Add it first: admin.js add-group ${chatId} <name>`);
      process.exit(1);
    }
    let allowFrom;
    if (value === '*') {
      allowFrom = ['*'];
    } else {
      allowFrom = value.split(',').map(s => s.trim()).filter(Boolean);
      if (!allowFrom.length) {
        console.error('Usage: admin.js set-group-allowfrom <chat_id> <id1,id2,...|*>');
        process.exit(1);
      }
    }
    config.groups[chatId].allowFrom = allowFrom;
    if (!saveConfig(config)) {
      console.error('[zalo] Failed to save config');
      process.exit(1);
    }
    const senders = allowFrom.includes('*') ? 'anyone (all members)' : allowFrom.join(', ');
    console.log(`Group ${chatId} allowFrom set to: ${senders}`);
    console.log('Run: pm2 restart zylos-zalo');
  },

  'set-group-history-limit': (chatId, limit) => {
    chatId = String(chatId || '').trim();
    const n = Number(limit);
    if (!chatId || !Number.isInteger(n) || n < 0) {
      console.error('Usage: admin.js set-group-history-limit <chat_id> <n>');
      process.exit(1);
    }
    const config = loadConfig();
    if (!config.groups || !config.groups[chatId]) {
      console.error(`Group ${chatId} not found. Add it first: admin.js add-group ${chatId} <name>`);
      process.exit(1);
    }
    config.groups[chatId].historyLimit = n;
    if (!saveConfig(config)) {
      console.error('[zalo] Failed to save config');
      process.exit(1);
    }
    console.log(`Group ${chatId} historyLimit set to: ${n}`);
    console.log('Run: pm2 restart zylos-zalo');
  },

  doctor: async () => {
    const config = loadConfig();
    const { runDoctor, formatDoctorReport } = await import('../src/lib/doctor.js');
    const results = await runDoctor(config);
    console.log(formatDoctorReport(results));
    const failed = results.filter(r => !r.ok);
    if (failed.length) {
      console.log(`\n${failed.length} check(s) need attention.`);
      process.exitCode = 1;
    } else {
      console.log('\nAll checks passed.');
    }
  },

  help: () => {
    console.log(`
zylos-zalo admin CLI

Commands:
  show                                   Show config (token masked)

  DM Access Control:
  set-dm-policy <open|allowlist|owner|pairing>  Set DM policy
  list-dm-allow                          Show DM policy and allowFrom list
  add-dm-allow <user_id>                 Add user to dmAllowFrom
  remove-dm-allow <user_id>              Remove user from dmAllowFrom
  set-dm-welcome <message>               Set first-contact DM welcome message
  show-dm-welcome                        Show first-contact DM welcome message
  clear-dm-welcome                       Disable first-contact DM welcome message

  DM Pairing (dmPolicy: pairing):
  dm-pending                             List pending DM access requests
  dm-approve <user_id>                   Approve a pending request (adds to dmAllowFrom)
  dm-deny <user_id> [reason]             Deny a request (records denial)

  Group Access Control:
  set-group-policy <open|allowlist|disabled>    Set group policy
  list-groups                            List configured groups (policy, allowFrom, historyLimit)
  add-group <chat_id> <name>             Add a group (allowFrom defaults to anyone)
  remove-group <chat_id>                 Remove a group from config
  set-group-allowfrom <chat_id> <id1,id2,...|*>  Restrict senders ("*" = anyone)
  set-group-history-limit <chat_id> <n>  Set per-group context message limit

  Bot Settings:
  set-delivery <polling|webhook>         Set message delivery mode
  show-owner                             Show current owner

  Diagnostics:
  doctor                                 Run operator health checks (token, API, webhook, perms)

  help                                   Show this help

Permission flow:
  DM: dmPolicy (open|allowlist|owner|pairing) + dmAllowFrom
  pairing: unknown senders are queued for owner approval (dm-pending/approve/deny)
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
  const result = commands[command](...args.slice(1));
  if (result && typeof result.then === 'function') {
    result.catch(err => {
      console.error(`[zalo] ${err.message}`);
      process.exit(1);
    });
  }
} else {
  console.error(`Unknown command: ${command}`);
  commands.help();
  process.exit(1);
}
