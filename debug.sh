#!/bin/bash

# 停止现有容器
docker-compose down

# 清理日志
rm -f logs/*

# 设置权限
chmod -R 777 data logs

# 重新构建并启动
docker-compose up --build -d

# 查看日志
docker-compose logs -f rtmp-server 