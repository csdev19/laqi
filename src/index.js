const express = require('express');
const app = express();
const fs = require('fs');
const cors = require('cors');

// Constants
const PORT = 8000;
const FILE_PATH = 'mock-data';


app.use(cors());
app.options('*', cors());


const files = fs.readdirSync(FILE_PATH);
const parsed = files
  .filter(file => file.indexOf('.json') !== -1)
  .map(file => {
    const dataRaw = fs.readFileSync(`${FILE_PATH}/${file}`, 'utf8');
    return JSON.parse(dataRaw);
  })
  .reduce((prev, curr) => {
    return { ...prev, ...curr }
  }, {});


const defineEndpoints = (data, app) => {
  for(let key in data) {
    const endpoint = data[key];
    if (!endpoint) return;
    const method = endpoint.method.toLowerCase()
    const path = `/${key}`;
    console.log({ method, path })
    app[method](path, (req, res) => {
      console.log('endpoint', endpoint)
      const codeResponse = endpoint.codeResponse || 200;
      const [response] = endpoint.responses
        .filter(resp => resp.selectorCode === codeResponse);
      console.log('hola', response)

      if (!response) return;

      return res
        .status(response.statusCode)
        .send(response.body);
    });
  }
}

defineEndpoints(parsed, app);

app.listen(PORT, () => {
  console.log('--------------------------------------------');
  console.log('| Mock Server running in port ' + PORT + ' |');
  console.log('--------------------------------------------');
});
