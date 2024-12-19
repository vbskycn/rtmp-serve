#!/bin/bash

# 确保脚本在错误时退出
set -e

echo "开始初始化数据库..."

# 确保数据目录存在
mkdir -p data

# 运行初始化脚本
docker-compose run --rm rtmp-server python -m scripts.init_db

echo "数据库初始化完成！"
echo "默认管理员账号: admin/admin"
echo "测试用户账号: test/test123" 