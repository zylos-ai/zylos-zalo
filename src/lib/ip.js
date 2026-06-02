import net from 'node:net';

function extractMappedIPv4(ip) {
  const dotted = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (dotted) return dotted[1];
  const hex = ip.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (hex) {
    const hi = parseInt(hex[1], 16), lo = parseInt(hex[2], 16);
    return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
  }
  return null;
}

function isPrivateIPv4(ip) {
  if (ip === '127.0.0.1' || ip === '0.0.0.0') return true;
  if (ip.startsWith('127.')) return true;
  if (ip.startsWith('10.') || ip.startsWith('192.168.')) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;
  if (ip.startsWith('169.254.') || ip.startsWith('0.')) return true;
  return false;
}

export function isPrivateIp(raw) {
  const stripped = String(raw).replace(/^\[|\]$/g, '');

  const mapped = extractMappedIPv4(stripped);
  if (mapped) return isPrivateIPv4(mapped);

  if (net.isIPv4(stripped)) return isPrivateIPv4(stripped);

  if (stripped === '::1' || stripped === '::' || stripped === '0:0:0:0:0:0:0:1' || stripped === '0000:0000:0000:0000:0000:0000:0000:0001') return true;
  if (/^fe[89ab][0-9a-f]:/i.test(stripped)) return true;
  if (stripped.startsWith('fc') || stripped.startsWith('fd')) return true;

  return false;
}
