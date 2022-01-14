const Configuration = require('./configuration');
const Server = require('./server');

const configuration = new Configuration();

const execute = () => {
  const data = configuration.loadData();
  const server = new Server(configuration.port, configuration.ip, configuration.path);
  server.defineEndpoints(data);
  server.start();
}

module.exports = execute;