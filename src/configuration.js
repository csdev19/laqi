const { defaultMaxListeners } = require('events');
const fs = require('fs');

// Constants
const CONFIG_FILE_PATH = 'mock.config.json';

// Default constants
const DEFAULT_PORT = 8000;
const DEFAULT_IP = '127.0.0.1';
const DEFAULT_PATH = 'mock-data';

class Configuration {
  constructor() {
    const config = JSON.parse(fs.readFileSync(CONFIG_FILE_PATH, 'utf8'));
    // set configuration variables
    this.port = config?.port || DEFAULT_PORT;
    this.path = config?.path || DEFAULT_PATH;
    this.ip = config?.ip || DEFAULT_IP;
  }

  loadData() {
    const files = fs.readdirSync(this.path);
    const parsed = files
      .filter(file => file.indexOf('.json') !== -1)
      .map(file => {
        const dataRaw = fs.readFileSync(`${this.path}/${file}`, 'utf8');
        return JSON.parse(dataRaw);
      })
      .reduce((prev, curr) => {
        return { ...prev, ...curr }
      }, {});
    return parsed;
  }

  getConfig() {
    return {
      port: this.port,
      ip: this.ip,
      path: this.path
    }
  }
}

module.exports = Configuration;
