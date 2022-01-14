# LAQI

⚡⚡ Laqi is a mock server to speed up frontend development ⚡⚡

## Why that name?

The name is composed of 2 Quechua words [llul**LA**](https://es.glosbe.com/quz/es/llulla) (meaning false) and [chas**Q**u**I**](https://es.glosbe.com/qu/es/chaski) (referring to a messenger) that together I give the meaning of "false-messenger" (l**L**ull**A** + chas**Q**u**I** = **LAQI**) for being a server that returns simulated or false information. Also that in English sounds like the word **"lucky"** 😃😃.

On spanish [here](documentacion/name.md)

## Installation

Just install the package with `npm install laqi`

## Usage

This is a practical mock server based on jsons. All you need to have to do is:

1. Create a file called `mock.config.json` in the root of you project with the following structure in case you want to custom your mock server:
   ```json
   {
    "ip": "127.0.0.1",
    "port": 8000,
    "path": "mock-data"
    }
   ```
2. Create a folder called `mock-data` or the one you specified in the config file
3. Put jsons in the folder with this structure:
   ```json
   {
      "path-name": {
        "method": "GET", // ["GET", "POST", "PUT", "DELETE"]
        "codeResponse": "200", // This code match with responses selectorCode item
        "responses": [
          {
            "statusCode": "200", // The status code of the response
            "selectorCode": "200", // The code to select the response
            "body": { // The body of the response
              "message": "OK"
            }
          },
          {
            "statusCode": "400",
            "selectorCode": "code1",
            "body": {
              "code": "code1",
              "description": "Invalid data.",
              "errorType": "Functional"
            }
          },
          {
            "statusCode": "401",
            "selectorCode": "code2",
            "body": {
              "code": "code2",
              "description": "Unauthorized User.",
              "errorType": "Functional"
            }
          }
        ]
      },
    }
   ```
5. You can add the following script to your package.json:
  ```json
  "scripts": {
    ...
    "mock": "laqi"
  }
   ```
4. Then start the server with `npm run mock` or simply `npx laqi` without adding the script to your package.json

## Contributors

- Cristian Sotomayor [@csdev19](https://github.com/csdev19) - Creator


