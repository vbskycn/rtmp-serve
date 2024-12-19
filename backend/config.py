import os
from dotenv import load_dotenv

class Config:
    def __init__(self):
        load_dotenv()
        self.PORT = int(os.getenv('PORT', 10088))
        self.HOST = os.getenv('HOST', '0.0.0.0')
        self.DEBUG = os.getenv('DEBUG', 'False').lower() == 'true'
        self.DB_URL = os.getenv('DB_URL', 'sqlite:///streams.db')
        self.MAX_RETRIES = int(os.getenv('MAX_RETRIES', 3))
        self.FFMPEG_PATH = os.getenv('FFMPEG_PATH', 'ffmpeg') 