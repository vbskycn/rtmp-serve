module.exports = {
  apps: [{
    name: 'rtmp-serve',
    script: './src/server.js',
    watch: false,
    instances: 1,
    autorestart: true,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production'
    }
  }]
}; 