from sqlalchemy import create_engine, Column, String, DateTime, Boolean
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from datetime import datetime
import json
import os

Base = declarative_base()
engine = create_engine('sqlite:///data/streams.db')
Session = sessionmaker(bind=engine)

class Stream(Base):
    __tablename__ = 'streams'
    
    id = Column(String, primary_key=True)
    name = Column(String)  # 频道名称
    source_url = Column(String)
    output_url = Column(String)
    key = Column(String)
    video_codec = Column(String)
    video_bitrate = Column(String)
    audio_codec = Column(String)
    audio_bitrate = Column(String)
    created_at = Column(DateTime, default=datetime.now)
    is_active = Column(Boolean, default=True)
    
    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'sourceUrl': self.source_url,
            'outputUrl': self.output_url,
            'key': self.key,
            'videoCodec': self.video_codec,
            'videoBitrate': self.video_bitrate,
            'audioCodec': self.audio_codec,
            'audioBitrate': self.audio_bitrate,
            'isActive': self.is_active
        }

    def export_to_file(self, filename):
        streams = self.session.query(Stream).all()
        data = [stream.to_dict() for stream in streams]
        with open(filename, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

    def import_from_file(self, filename):
        with open(filename, 'r', encoding='utf-8') as f:
            data = json.load(f)
        for stream_data in data:
            stream = Stream(**stream_data)
            self.session.add(stream)
        self.session.commit()

    @classmethod
    def ensure_db_permissions(cls):
        """确保数据库文件和目录权限正确"""
        db_path = 'data/streams.db'
        db_dir = os.path.dirname(db_path)
        
        # 确保目录存在且有正确权限
        if not os.path.exists(db_dir):
            os.makedirs(db_dir, mode=0o755)
        
        # 确保数据库文件存在且有正确权限
        if not os.path.exists(db_path):
            Base.metadata.create_all(engine)
            os.chmod(db_path, 0o644)
        
        return True

# 创建数据库表
Base.metadata.create_all(engine) 