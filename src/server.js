const express = require('express');
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

        return res
        .status(response.statusCode)
        .send(response.body);
      });
    }
  }

  start() {
    this.app.listen(this.port, this.ip, () => {
      console.log('--------------------------------------------');
      console.log('| Mock Server running in port: ' + this.port + ' & ip: ' + this.ip + ' |');
      console.log('--------------------------------------------');
    });
  }
}

module.exports = Server;