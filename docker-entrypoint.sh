#!/bin/bash
set -e

# 确保数据目录存在并设置正确权限
mkdir -p /app/data /app/logs
chown -R nobody:nogroup /app/data /app/logs
chmod -R 777 /app/data /app/logs

# 使用 gosu 切换到 nobody 用户运行命令
exec gosu nobody "$@" 