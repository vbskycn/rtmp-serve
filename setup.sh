#!/bin/bash

# 安装 python3-venv（如果需要）
if ! command -v python3 -m venv &> /dev/null; then
    sudo apt install python3-venv
fi

# 创建虚拟环境
python3 -m venv venv

# 激活虚拟环境
source venv/bin/activate

# 安装依赖
pip install -r requirements.txt

# 提示安装完成
echo "安装完成！使用以下命令启动服务："
echo "bash start.sh" 