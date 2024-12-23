#!/bin/bash

# 创建必要的目录
mkdir -p config streams logs

# 如果 config.json 不存在，创建默认配置
if [ ! -f config/config.json ]; then
  echo '{
    "server": {
      "host": "auto",
      "port": 3000
    },
    "rtmp": {
      "pushServer": "rtmp://ali.push.yximgs.com/live/",
      "pullServer": "http://ali.hlspull.yximgs.com/live/"
    }
  }' > config/config.json
fi

# 启动容器
docker-compose up -d 