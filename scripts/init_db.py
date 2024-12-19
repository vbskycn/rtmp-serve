from backend.models import Base, engine, Session, Stream
from datetime import datetime

def init_db():
    # 创建数据库表
    Base.metadata.create_all(engine)
    
    # 创建会话
    session = Session()
    
    # 检查是否已经有数据
    if session.query(Stream).count() == 0:
        # 添加一些示例流
        default_streams = [
            {
                'id': '4gtv-4gtv009',
                'name': '民视新闻台',
                'source_url': 'http://pix.zbds.top/litv/4gtv-4gtv009',
                'output_url': 'rtmp://ali.push.yximgs.com/live/',
                'key': '4gtv-4gtv009',
                'video_codec': 'copy',
                'video_bitrate': '',
                'audio_codec': 'copy',
                'audio_bitrate': '128k',
                'created_at': datetime.now(),
                'is_active': False
            },
            {
                'id': '4gtv-4gtv052',
                'name': '华视新闻资讯台',
                'source_url': 'http://pix.zbds.top/litv/4gtv-4gtv052',
                'output_url': 'rtmp://ali.push.yximgs.com/live/',
                'key': '4gtv-4gtv052',
                'video_codec': 'copy',
                'video_bitrate': '',
                'audio_codec': 'copy',
                'audio_bitrate': '128k',
                'created_at': datetime.now(),
                'is_active': False
            }
        ]
        
        for stream_data in default_streams:
            stream = Stream(**stream_data)
            session.add(stream)
        
        # 提交更改
        session.commit()
    
    session.close()

if __name__ == '__main__':
    init_db() 