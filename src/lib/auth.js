/**
 * Authentication and access control for zylos-zalo
 */

import { saveConfig } from './config.js';

export function hasOwner(config) {
  return config.owner && config.owner.user_id !== null;
}

export function bindOwner(config, userId, userName) {
  const prevOwner = config.owner;
  const prevDmAllowFrom = config.dmAllowFrom ? [...config.dmAllowFrom] : undefined;

  config.owner = {
    user_id: String(userId),
    name: userName || null,
    bound_at: new Date().toISOString()
  };
  if (!Array.isArray(config.dmAllowFrom)) config.dmAllowFrom = [];
  if (!config.dmAllowFrom.includes(String(userId))) {
    config.dmAllowFrom.push(String(userId));
  }

  if (!saveConfig(config)) {
    config.owner = prevOwner;
    config.dmAllowFrom = prevDmAllowFrom;
    console.error(`[zalo] Owner binding failed: config save error`);
    return false;
  }

  console.log(`[zalo] Owner bound: ${userName || userId}`);
  return true;
}

export function isOwner(config, userId) {
  if (!hasOwner(config)) return false;
  return String(userId) === String(config.owner.user_id);
}

export function isDmAllowed(config, userId) {
  if (isOwner(config, userId)) return true;
  const policy = config.dmPolicy || 'owner';
  if (policy === 'open') return true;
  if (policy === 'owner') return false;
  return (config.dmAllowFrom || []).map(String).includes(String(userId));
}

export function isGroupAllowed(config, chatId) {
  const policy = config.groupPolicy || 'allowlist';
  if (policy === 'disabled') return false;
  if (policy === 'open') return true;
  return !!config.groups?.[String(chatId)];
}

export function isGroupSenderAllowed(config, chatId, senderId) {
  if (isOwner(config, senderId)) return true;
  const groupConfig = config.groups?.[String(chatId)] || {};
  const allowFrom = Array.isArray(groupConfig.allowFrom) ? groupConfig.allowFrom : [];
  if (allowFrom.length === 0 || allowFrom.includes('*')) return true;
  return allowFrom.map(String).includes(String(senderId));
}

export function getGroupName(config, chatId, fallback) {
  const gc = config.groups?.[String(chatId)];
  return gc?.name || fallback || 'group';
}

export function addGroup(config, chatId, name, mode = 'mention') {
  chatId = String(chatId);
  if (!config.groups) config.groups = {};
  if (config.groups[chatId]) return false;
  config.groups[chatId] = {
    name,
    mode,
    allowFrom: ['*'],
    historyLimit: config.message?.context_messages || 5,
    added_at: new Date().toISOString()
  };
  saveConfig(config);
  console.log(`[zalo] Group added: ${name} (${chatId}) mode=${mode}`);
  return true;
}
