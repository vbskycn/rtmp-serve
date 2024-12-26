module.exports = {
  apps: [{
    name: "stream-server",
    script: "./src/server.js",
    cwd: __dirname,
    env: {
      NODE_ENV: "production",
    },
    error_file: "./logs/err.log",
    out_file: "./logs/out.log",
    time: true
  }]
}; 