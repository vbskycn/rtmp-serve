from backend.models import Base, engine

def init_db():
    # 创建所有表
    Base.metadata.create_all(engine)
    print("Database initialized successfully")

if __name__ == '__main__':
    init_db() 