// PM2 process config — keeps the app running and restarts it on crash/reboot.
//   pm2 start ecosystem.config.js --env production
//
// Keep instances at 1: socket.io without a Redis adapter + sticky sessions
// cannot share clients across multiple Node processes.
module.exports = {
  apps: [
    {
      name: 'location-tracker',
      script: 'app.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '300M',
      time: true,
      env: {
        NODE_ENV: 'development',
        PORT: 3000,
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000, // must match the upstream in deploy/nginx/location-tracker.conf
      },
    },
  ],
};
