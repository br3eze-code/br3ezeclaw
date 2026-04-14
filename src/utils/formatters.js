'use strict';

const formatBytes = (bytes, decimals = 2) => {
  if (bytes === 0) return '0 B';
  const k     = 1024;
  const dm    = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i     = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
};

// Parse MikroTik uptime format e.g. "2d3h15m40s"
const formatUptime = (uptime) => {
  if (!uptime) return '0s';
  const match = uptime.match(/(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/);
  if (!match) return uptime;
  const [, d, h, m, s] = match;
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (s) parts.push(`${s}s`);
  return parts.join(' ') || '0s';
};

module.exports = { formatBytes, formatUptime };

