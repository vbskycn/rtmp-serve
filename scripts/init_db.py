from sqlalchemy import create_engine
from backend.models import Base, User, Stream
from sqlalchemy.orm import sessionmaker
import os

def init_db():
    # 确保数据目录存在
    db_dir = '/app/data'
    if not os.path.exists(db_dir):
        os.makedirs(db_dir)
        
    # 创建数据库连接
    db_url = 'sqlite:////app/data/streams.db'
    engine = create_engine(db_url)
    
    # 创建所有表
    Base.metadata.create_all(engine)
    
    # 创建会话
    Session = sessionmaker(bind=engine)
    session = Session()
    
    try:
        # 检查是否已存在管理员账号
        admin = session.query(User).filter_by(username='admin').first()
        if not admin:
            # 创建默认管理员账号
            admin = User(
                username='admin',
                is_admin=True
            )
            admin.set_password('admin')  # 默认密码
            session.add(admin)
            
            # 创建测试用户账号
            test_user = User(
                username='test',
                is_admin=False
            )
            test_user.set_password('test123')
            session.add(test_user)
            
            # 添加一些测试流配置
            test_streams = [
                Stream(
                    id='test1',
                    name='测试流1',
                    source_url='rtmp://test.source.com/live/stream1',
                    output_url='rtmp://localhost:1935/live/',
                    key='test1',
                    video_codec='copy',
                    audio_codec='aac',
                    audio_bitrate='128k',
                    is_active=False
                ),
                Stream(
                    id='test2',
                    name='测试流2',
                    source_url='rtmp://test.source.com/live/stream2',
                    output_url='rtmp://localhost:1935/live/',
                    key='test2',
                    video_codec='h264',
                    video_bitrate='2000k',
                    audio_codec='aac',
                    audio_bitrate='128k',
                    is_active=False
                )
            ]
            
            for stream in test_streams:
                session.add(stream)
            
            session.commit()
            print("数据库初始化成功！")
            print("创建了管理员账号 (admin/admin) 和测试用户 (test/test123)")
            print("添加了两个测试流配置")
        else:
            print("数据库已经初始化过了")
            
    except Exception as e:
        print(f"初始化数据库时出错: {e}")
        session.rollback()
    finally:
        session.close()

if __name__ == '__main__':
    init_db() 