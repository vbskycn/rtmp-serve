#!/bin/bash

# 创建必要的目录
mkdir -p data logs
chmod -R 777 data logs

# 获取当前用户的 UID 和 GID
export UID=$(id -u)
export GID=$(id -g)

# 启动服务
docker-compose up --build -d 