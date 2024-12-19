from sqlalchemy import create_engine, Column, String, DateTime, Boolean
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
import os
from datetime import datetime

# 确保数据目录存在
def ensure_db_dir():
    db_dir = '/app/data'
    if not os.path.exists(db_dir):
        try:
            os.makedirs(db_dir)
        except Exception as e:
            print(f"Warning: Could not create directory {db_dir}: {e}")

ensure_db_dir()

# 创建数据库引擎
engine = create_engine('sqlite:////app/data/streams.db', 
    connect_args={
        'check_same_thread': False,
        'timeout': 30
    },
    # 添加 echo 用于调试
    echo=True
)

Session = sessionmaker(bind=engine)
Base = declarative_base()

class Stream(Base):
    __tablename__ = 'streams'
    
    id = Column(String, primary_key=True)
    name = Column(String)
    source_url = Column(String)
    output_url = Column(String)
    key = Column(String)
    video_codec = Column(String)
    video_bitrate = Column(String)
    audio_codec = Column(String)
    audio_bitrate = Column(String)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.now)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)
    
    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'source_url': self.source_url,
            'output_url': self.output_url,
            'key': self.key,
            'video_codec': self.video_codec,
            'video_bitrate': self.video_bitrate,
            'audio_codec': self.audio_codec,
            'audio_bitrate': self.audio_bitrate,
            'is_active': self.is_active,
            'created_at': self.created_at.isoformat(),
            'updated_at': self.updated_at.isoformat()
        }

# 创建数据库表
try:
    Base.metadata.create_all(engine)
except Exception as e:
    print(f"Error creating database: {e}") 