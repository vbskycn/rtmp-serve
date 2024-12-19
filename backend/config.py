import os
from datetime import timedelta

class Config:
    # 基础配置
    SECRET_KEY = os.getenv('SECRET_KEY', 'your-secret-key-here')
    DEBUG = os.getenv('DEBUG', 'False').lower() == 'true'
    
    # 数据库配置
    DB_URL = os.getenv('DB_URL', 'sqlite:///data/streams.db')
    
    # 会话配置
    SESSION_TYPE = 'filesystem'
    SESSION_FILE_DIR = 'data/sessions'
    SESSION_FILE_THRESHOLD = 500
    PERMANENT_SESSION_LIFETIME = timedelta(days=7)
    
    # RTMP配置
    REMOTE_RTMP_URL = os.getenv('REMOTE_RTMP_URL', 'rtmp://ali.push.yximgs.com/live/')
    LOCAL_RTMP_URL = os.getenv('LOCAL_RTMP_URL', 'rtmp://localhost:1935/live/')
    
    # 管理员账号配置
    ADMIN_USERNAME = os.getenv('ADMIN_USERNAME', 'admin')
    ADMIN_PASSWORD = os.getenv('ADMIN_PASSWORD', 'admin')