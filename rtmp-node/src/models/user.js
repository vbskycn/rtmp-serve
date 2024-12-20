const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

const USERS_FILE = path.join(__dirname, '../../data/users.json');

class UserModel {
  async initDefaultUser() {
    try {
      const users = await this.getUsers();
      if (users.length === 0) {
        const defaultUser = {
          id: '1',
          username: 'admin',
          password: this.hashPassword('mfk123456'),
          role: 'admin'
        };
        await this.saveUsers([defaultUser]);
      }
    } catch (error) {
      console.error('初始化默认用户失败:', error);
    }
  }

  hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
  }

  async getUsers() {
    try {
      const data = await fs.readFile(USERS_FILE, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      return [];
    }
  }

  async saveUsers(users) {
    await fs.writeFile(USERS_FILE, JSON.stringify(users, null, 2));
  }
}

module.exports = new UserModel(); 