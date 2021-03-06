# LAQI

⚡⚡ Laqi is a mock server to speed up frontend development ⚡⚡

## Installation
------------

Just install the package with `npm install laqi` you can use it with the `--save-dev` flag.


## Features
-----------

- [x] Accept methods GET, POST, PUT, DELETE
- [x] Refresh endpoints by the change of the files automatically
- [x] Nested files to group endpoints
- [x] Type of response: JSON
- [x] Posibility to specify the response method (GET, POST, PUT, DELETE) with the same name fixing json problem
- [ ] Create example files
- [ ] Documented CLI

## Documentation

### Usage
------------

This is a practical mock server based on JSONS. All you need to have to do is:

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
        "codeResponse": "success", // This code match with responses selectorCode item
        "responses": [
          {
            "statusCode": "200", // The status code of the response
            "selectorCode": "success", // The code to select the response
            "body": { // The body of the response
              "message": "OK"
            }
          },
          {
            "statusCode": "400",
            "selectorCode": "error400",
            "body": {
              "description": "Invalid data.",
              "errorType": "Functional"
            }
          },
          {
            "statusCode": "401",
            "selectorCode": "error401",
            "body": {
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


### How it works
-------------

With Laqi you can mock your API responses without having to write a real backend. You can use the same API as your real backend, but the responses will be mocked. All you have to do it's create `mock.config.json` file in your project root and create a folder `mock-data`. Inside this folder you can create multiple JSON files or folder with JSON files inside, the server will use the JSON files to create the endpoints based on the following structure of the JSON:

| Atribute | Description |
|----------|-------------|
| "path-name" | The name of the endpoint. You can use `:param` to create dynamic endpoints. |
| "method" | The method of the endpoint. |
| "codeResponse" | The code to select the response. |
| "responses" | The list of responses. |
| "statusCode" | The HTTP status code of the response. |
| "selectorCode" | The code to select the response. |
| "body" | The body of the response. |


For example
```json
{
  "path-name": {
    "method": "GET",
    "codeResponse": "success",
    "responses": [
      {
        "statusCode": "200",
        "selectorCode": "success",
        "body": {
          "message": "OK"
        }
      },
      {
        "statusCode": "400",
        "selectorCode": "error400",
        "body": {
          "description": "Invalid data.",
          "errorType": "Functional"
        }
      },
      {
        "statusCode": "401",
        "selectorCode": "error401",
        "body": {
          "description": "Unauthorized User.",
          "errorType": "Functional"
        }
      }
    ]
  },
}
```

## Case of use one endpoint multiple methods

The case of use for example is when you want to create a endpoint that accept multiple methods. The endpoint's name is `products` and you want to GET all the products and get an specific product and you need to do **products/:id** to get an specific product. And you also want to POST, PUT and DELETE the product, in the clasic json format doesn't ley you to do this, so you need to create a new endpoint specifying the method like this `(get/post/put/delete)products/:id` and the server will work with the method you specify in the parenthesis.

```JSON
  "(get)files/:id": {
    "method": "GET",
    "codeResponse": "200",
    "responses": [
      {
        "statusCode": "200",
        "selectorCode": "200",
        "body": {
          "message": "OK"
        }
      },
      {
        "statusCode": "400",
        "selectorCode": "error400",
        "body": {
          "code": "error1",
          "description": "Invalid data.",
          "errorType": "Functional"
        }
      },
      {
        "statusCode": "401",
        "selectorCode": "error401",
        "body": {
          "code": "error2",
          "description": "Unauthorized User.",
          "errorType": "Functional"
        }
      }
  }
```


You can also use the `mock.config.json` file to configure the server.

### Structure of the `mock.config.json` file
----------------------

- IP: The IP address of the server. This attribute is made for mobile developers who need to connect to an API with a set IP address
  You can left this field empty if you want.
  Default: 127.0.0.1.
- PORT: The port of the server. In case you need to setup a specific port, you can set it here.
  Default: 8000
- PATH: The path of the mock-data folder. Here you can create the JSON files with the endpoints. You can change the name of the folder if you want.
  Default: mock-data

```json
{
  "ip": "127.0.0.1",
  "port": 8000,
  "path": "mock-data"
}
```


## Why that name?
-----------

The name is composed of 2 Quechua words [llul**LA**](https://es.glosbe.com/quz/es/llulla) (meaning false) and [chas**Q**u**I**](https://es.glosbe.com/qu/es/chaski) (referring to a messenger) that together I give the meaning of "false-messenger" (l**L**ull**A** + chas**Q**u**I** = **LAQI**) for being a server that returns simulated or false information. Also that in English sounds like the word **"lucky"** 😃😃.

On spanish [here](documentacion/name.md)



## Contributors
--------

- Cristian Sotomayor [@csdev19](https://github.com/csdev19) - Creator


