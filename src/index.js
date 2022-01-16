const Configuration = require('./configuration');
const Server = require('./server');

const configuration = new Configuration();
const chokidar = require('chokidar');

const execute = () => {
  try {

    const server = new Server(configuration.port, configuration.ip, configuration.path);
    const data = configuration.loadData();
    server.defineEndpoints(data);
    server.start();
    chokidar.watch('./mock-data', {
      ignored: /[\/\\]\./,
      persistent: false,
    }).on('change', (event, path) => {
      server.end();
      server.defineEndpoints(data);
      server.start();
    });

  } catch (error) {
    console.log('error', error)
  }
}

module.exports = execute;