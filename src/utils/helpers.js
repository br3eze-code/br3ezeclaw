// src/utils/helpers.js
function parseSystemStats(rawData) {
  return {
    cpu: rawData['cpu-load'] || rawData['cpu-usage'] || '0',
    uptime: formatUptime(rawData.uptime),
    version: rawData.version
  };
}
