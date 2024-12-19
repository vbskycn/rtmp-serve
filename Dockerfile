FROM python:3.8-slim

# 安装系统依赖
RUN apt-get update && apt-get install -y \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# 设置工作目录
WORKDIR /app

# 复制项目文件
COPY requirements.txt .
COPY backend/ backend/

# 创建必要的目录
RUN mkdir -p data/sessions logs

# 安装 Python 依赖
RUN pip install --no-cache-dir -r requirements.txt

# 设置数据目录权限
RUN chown -R nobody:nogroup /app/data /app/logs

# 切换到非 root 用户
USER nobody

# 启动命令
CMD ["gunicorn", "-w", "4", "-b", "0.0.0.0:5000", "backend.app:app"] 