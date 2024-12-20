const fs = require('fs').promises;
const path = require('path');

class UserModel {
  constructor() {
    this.dataDir = path.join(__dirname, '../../data');
    this.usersFile = path.join(this.dataDir, 'users.json');
  }

  async initDefaultUser() {
    try {
      // 确保data目录存在
      await fs.mkdir(this.dataDir, { recursive: true });
      
      // 检查users.json是否存在
      try {
        await fs.access(this.usersFile);
      } catch (err) {
        // 文件不存在，创建默认用户
        const defaultUsers = [{
          username: 'admin',
          password: 'admin123', // 建议使用更安全的密码存储方式
          role: 'admin'
        }];
        
        await this.saveUsers(defaultUsers);
        console.log('已创建默认用户');
        return;
      }
      
      console.log('用户文件已存在，跳过初始化');
    } catch (err) {
      console.error('初始化默认用户失败:', err);
      throw err;
    }
  }

  async saveUsers(users) {
    await fs.writeFile(this.usersFile, JSON.stringify(users, null, 2));
  }

  // ... 其他方法 ...
}

module.exports = new UserModel(); 
module.exports = new UserModel(); 