import os
from dotenv import load_dotenv

load_dotenv()

class Config:
    PORT = int(os.getenv('PORT', 10088))
    HOST = os.getenv('HOST', '0.0.0.0')
    DEBUG = os.getenv('DEBUG', 'True').lower() == 'true'
    DB_URL = os.getenv('DB_URL', 'sqlite:///data/streams.db')
    LOG_LEVEL = os.getenv('LOG_LEVEL', 'DEBUG')
    REMOTE_RTMP_URL = os.getenv('REMOTE_RTMP_URL', 'rtmp://ali.push.yximgs.com/live/')
    LOCAL_RTMP_URL = os.getenv('LOCAL_RTMP_URL', 'rtmp://srs:1935/live/')