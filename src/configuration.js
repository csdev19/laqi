const fs = require('fs');

// Constants
const CONFIG_FILE_PATH = 'mock.config.json';

// Default constants
const DEFAULT_PORT = 8000;
const DEFAULT_IP = '127.0.0.1';
const DEFAULT_PATH = 'mock-data';

class Configuration {
  constructor() {
    let config;
    try {
      config = JSON.parse(fs.readFileSync(CONFIG_FILE_PATH, 'utf8'));
    } catch (error) {
      config = {};
    } finally {
      // set configuration variables
      this.port = config?.port || DEFAULT_PORT;
      this.path = config?.path || DEFAULT_PATH;
      this.ip = config?.ip || null;
    }
  }

  loadData() {

    const data = this.recursiveChargeFiles(this.path);
    const parsedData = data.reduce((prev, curr) => {
      return { ...prev, ...curr }
    }, {});

    return parsedData;
  }

  extractJsonFromFile(filePath) {
    const dataRaw = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(dataRaw || '{}');
    return data;
  }

  recursiveChargeFiles(basePath, filesJson = {}) {
    const files = fs.readdirSync(basePath);

    if (!files) return filesJson;
    if (files.length === 0) return filesJson;

    const newFilesJson = files
      .map(file => {
        const filePath = `${basePath}/${file}`;
        if (file.indexOf('.json') !== -1) {
          const extractedJson = this.extractJsonFromFile(filePath);
          return { ...filesJson, ...extractedJson };
        } else if (file.indexOf('.') !== -1) {
          return {}
        } else {
          const isDirectory = fs.lstatSync(filePath).isDirectory()
          if (!isDirectory) return {}
          const result = this.recursiveChargeFiles(filePath, filesJson);
          return (Array.isArray(result) ? result : []).reduce((prev, curr) => {
            return { ...prev, ...curr }
          }, {});
        }
      })
    return newFilesJson;
  }

}

module.exports = Configuration;
