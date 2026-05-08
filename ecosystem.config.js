module.exports = {
  apps: [
    {
      name: 'agentos-gateway',
      script: './bin/agentos.js',
      args: 'gateway',
      env: {
        NODE_ENV: 'production'
      },
      env_dev: {
        NODE_ENV: 'development',
        AGENTOS_PROFILE: 'dev'
      },
      // Give the process 8 s to release the port before PM2 respawns it.
      // Without this, the new instance starts before the old OS socket is
      // freed → EADDRINUSE → crash loop.
      kill_timeout: 8000,
      // Back off restarts exponentially (1 500 ms, 3 s, 6 s …) so a bad
      // boot doesn't hammer the system 100+ times in a minute.
      exp_backoff_restart_delay: 1500,
      restart_delay: 5000,
      max_restarts: 10,
      // Restart if memory climbs above 512 MB (guards against leaks).
      max_memory_restart: '512M'
    },
    {
      name: 'agentos-logs',
      script: './src/cli/daemon/logs-daemon.js',
      env: {
        NODE_ENV: 'production'
      },
      kill_timeout: 3000,
      restart_delay: 2000
    }
  ]
};
