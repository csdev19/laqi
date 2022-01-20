const express = require('express');
const killable = require('killable');
const cors = require('cors');

class Server {
  constructor(port, ip, path) {
    this.port = port;
    this.ip = ip;
    this.path = path;
  }

  async initialize(data) {
    if (this.server) {
      await this.stop()
    }
    this.app = express();
    this.app.use(cors());
    this.app.options('*', cors());
    this.defineEndpoints(data);
    this.start();
  }

  defineEndpoints(data) {
    for(let key in data) {
      const endpoint = data[key];
      if (!endpoint) return;
      const method = endpoint.method.toLowerCase()
      const path = `/${key}`;
      this.app[method](path, (req, res) => {
        const codeResponse = endpoint.codeResponse || 200;
        const [response] = endpoint.responses
        .filter(resp => resp.selectorCode === codeResponse);

        if (!response) return;

        const body = response.body;
        if (Object.keys(req.params).length > 0){
          body.params = req.params;
        }

        res
          .status(response.statusCode)
          .send(body);
      });
    }
  }

  start() {
    this.server = this.app.listen(this.port, this.ip, () => {
      console.log(`
        ⚡⚡ Mock Server running ⚡⚡
          -> port: ${this.port}
          ${this.ip ? '-> ip: ' + this.ip : ''}
      `);
    });

    killable(this.server);
  }

  stop() {
    return new Promise((resolve) => {
      if (!this.server) return resolve('Server not exists');
      this.server.kill(() => {
        this.server = null;
        return resolve('Server stopped');
      });
    });
  }

}

module.exports = Server;