module.exports = {
  apps: [{
    name: "rtmp-serve",
    script: "src/server.js",
    instances: "max",
    exec_mode: "cluster",
    watch: true,
    max_memory_restart: "1G",
    error_file: "logs/err.log",
    out_file: "logs/out.log",
    log_date_format: "YYYY-MM-DD HH:mm:ss",
    merge_logs: true,
    env: {
      NODE_ENV: "development",
    },
    env_production: {
      NODE_ENV: "production",
    }
  }]
}; 