#!/bin/bash

# 切换到 SRS 目录
cd "$(dirname "$0")"

# 启动 SRS
./objs/srs -c conf/srs.conf 