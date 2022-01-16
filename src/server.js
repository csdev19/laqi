const express = require('express');
const killable = require('killable');
const cors = require('cors');

class Server {
  constructor(port, ip, path) {
    this.app = express();
    this.app.use(cors());
    this.app.options('*', cors());

    this.port = port;
    this.ip = ip;
    this.path = path;
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
          -> ip: ${this.ip}
      `);
    });

    killable(this.server);
  }

  end() {
    this.server.close(() => {
      console.log(`
      ☠️  The server is closed ☠️
      `);
    });

  }
}

module.exports = Server;