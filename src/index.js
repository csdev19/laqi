const Configuration = require('./configuration');
const Server = require('./server');

const configuration = new Configuration();
const chokidar = require('chokidar');

const execute = () => {
  try {

    let data = configuration.loadData();

    const server = new Server(configuration.port, configuration.ip, configuration.path, data);
    server.initialize(data);
    chokidar.watch('./mock-data', {
      ignored: /[\/\\]\./,
      persistent: false,
    }).on('change', async (event, path) => {
      data = configuration.loadData();
      server.initialize(data);
    });

  } catch (error) {
    console.log('error', error)
  }
}

module.exports = execute;