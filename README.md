# Mock-server

This repository will contain the mock-server code. A library I want to publish.

## Installation


## Features

- Express
- Cors


## Usage

This is a practical mock server based on jsons. All you need to have to do is:

1. Create a folder called `mock-server`
2. Put jsons in the folder with this structure:
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
3. Start the server with `npm run dev`



