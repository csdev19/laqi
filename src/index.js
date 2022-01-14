const Configuration = require("./configuration");
const Server = require("./server");

const configuration = new Configuration();

const execute = () => {
  const data = configuration.loadData();
  const config = configuration.getConfig();
  const server = new Server(config.port, config.ip, config.path);
  server.defineEndpoints(data);
  server.start();
}

module.exports = execute;