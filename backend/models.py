from sqlalchemy import create_engine, Column, String, DateTime, Boolean
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
import os
from datetime import datetime

# 确保数据目录存在
os.makedirs('data', exist_ok=True)

# 创建数据库引擎
engine = create_engine('sqlite:///data/streams.db')
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
Base.metadata.create_all(engine) 