#!/bin/bash

# 创建必要的目录
mkdir -p data/sessions logs conf

# 设置权限
chmod -R 755 data logs conf

# 如果 requirements.txt 不存在，创建它
if [ ! -f requirements.txt ]; then
    cat > requirements.txt << EOF
flask
flask-cors
gunicorn
python-dotenv
psutil
flask-limiter
EOF
fi

# 如果数据库目录不存在，创建它
if [ ! -d data ]; then
    mkdir -p data
fi

# 检查并创建 srs 配置文件
if [ ! -f conf/srs.conf ]; then
    mkdir -p conf
    cp srs.conf.example conf/srs.conf
fi 