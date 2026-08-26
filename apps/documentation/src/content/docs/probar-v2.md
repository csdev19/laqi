---
title: Probar laqi v2
---

# Probar laqi v2

Un recorrido de punta a punta, en unos 15 minutos, por todo lo que v2 sabe
hacer: servir mocks, las cuatro capas de resolución, el panel web, la API,
el servidor MCP y la URL pública. Cada paso muestra el comando exacto y lo
que deberías ver.

Necesitás **Node 20+**. Bun sólo hace falta para construir desde el repo
(paso 0); el binario resultante corre en Node puro.

## 0. Construir el binario

Mientras el paquete no esté publicado en npm, se construye una vez desde el
repo:

```bash
git clone git@github.com:csdev19/laqi.git
cd laqi
bun install
bun run build
```

Eso deja el CLI autocontenido en `apps/cli/dist/index.mjs` — con el panel web
adentro. Para no escribir la ruta completa en cada paso:

```bash
alias laqi="node $(pwd)/apps/cli/dist/index.mjs"
```

> Cuando el paquete esté en npm, todo lo que sigue funciona igual con
> `npx laqi` y sin este paso.

## 1. Un proyecto con mocks

En cualquier carpeta vacía (fuera del repo de laqi):

```bash
mkdir demo && cd demo && mkdir laqi
```

`laqi/api.json` — las claves son `"METHOD /path"`:

```json
{
  "GET /users": {
    "description": "the people",
    "default": "ok",
    "responses": {
      "ok": { "status": 200, "body": [{ "id": 1, "name": "Ada" }] },
      "empty": { "status": 200, "body": [] },
      "boom": { "status": 500, "body": { "message": "boom" } }
    }
  },
  "GET /users/:id": {
    "default": "found",
    "responses": {
      "found": { "status": 200, "body": { "id": 1, "name": "Ada" } },
      "missing": { "status": 404 }
    }
  },
  "POST /orders": {
    "default": "created",
    "responses": {
      "created": { "status": 201, "body": { "id": 9 } },
      "error": { "status": 500, "delay": 2000, "body": { "message": "nope" } }
    }
  }
}
```

`laqi/scenarios.json` — un escenario mueve varios endpoints de una:

```json
{
  "todo-roto": { "GET /users": "boom", "POST /orders": "error" },
  "usuario-nuevo": { "GET /users": "empty" }
}
```

## 2. Arrancar y pedir

```bash
laqi
```

```
⚡ laqi  http://127.0.0.1:8000
   watching ./laqi/  ·  3 endpoints
```

Desde otra terminal:

```bash
curl -i http://127.0.0.1:8000/users
```

Mirá el header **`X-Laqi-Resolved: ok (default)`**: cada respuesta dice qué
se sirvió y **qué capa lo decidió**. Ese header es el hilo conductor de todo
lo que sigue.

```bash
curl http://127.0.0.1:8000/users/42        # :id es dinámico
curl -X POST http://127.0.0.1:8000/orders  # 201
curl http://127.0.0.1:8000/typo            # 404 con la lista de rutas reales
```

## 3. Las cuatro capas, una por una

De mayor a menor precedencia: `header` → `state` → `scenario` → `default`.

**Capa `header`** — por request, no persiste nada. Así probás una respuesta
sin cambiarle el estado a nadie:

```bash
curl -i -H 'X-Laqi-Response: boom' http://127.0.0.1:8000/users
# 500 · X-Laqi-Resolved: boom (header)
curl -i http://127.0.0.1:8000/users
# 200 de nuevo: no quedó nada activado
```

**Capa `state`** — un override persistente por endpoint (lo que escribe el
panel):

```bash
curl -X PUT http://127.0.0.1:8000/__laqi/api/state \
  -H 'Content-Type: application/json' \
  -d '{"scenario":null,"overrides":{"GET /users":"boom"}}'
curl -i http://127.0.0.1:8000/users
# 500 · X-Laqi-Resolved: boom (state)
```

Quedó en `.laqi/state.json` — archivo de máquina, gitignored. Tus mocks en
`laqi/` no se tocaron.

**Capa `scenario`**:

```bash
curl -X PUT http://127.0.0.1:8000/__laqi/api/state \
  -H 'Content-Type: application/json' \
  -d '{"scenario":"usuario-nuevo","overrides":{}}'
curl -i http://127.0.0.1:8000/users
# 200 [] · X-Laqi-Resolved: empty (scenario)
```

Y la regla clave: **un override le gana al escenario activo**. Con
`usuario-nuevo` activo, agregá `"overrides":{"GET /users":"boom"}` y `/users`
sirve `boom (state)` mientras el resto del escenario sigue vigente.

Volver a fojas cero:

```bash
curl -X PUT http://127.0.0.1:8000/__laqi/api/state \
  -H 'Content-Type: application/json' -d '{"scenario":null,"overrides":{}}'
```

## 4. El panel

Abrí **http://127.0.0.1:8000/__laqi** en el navegador. Todo lo del paso 3,
sin curl:

- **Un click en un chip** pone esa respuesta en vivo. La fila se tiñe de
  magenta y dice `state`. Clickeá el chip que es el default del archivo y el
  override se borra en vez de escribirse uno idéntico.
- **Los chips de escenarios** arriba: activá `todo-roto` y mirá cuántas filas
  se tiñen de violeta.
- **El log de la derecha** muestra cada request en vivo — dispará los curl
  del paso 2 y miralos aterrizar. Un path que no existe sale en rojo con
  `no matching route`. Click en una fila salta al endpoint que la sirvió.
- **`⌘K`** (o `Ctrl+K`): tipeá `orders error` y ↵ — flipeó `POST /orders`
  sin tocar el mouse.
- **Click en un path** abre el detalle: editá el body, el status o el delay
  y guardá — se escribe de vuelta a `laqi/api.json`. Ahí mismo hay un `curl`
  listo con `X-Laqi-Response` para copiar.
- **Hot-reload**: editá `laqi/api.json` a mano en tu editor y mirá el panel
  actualizarse solo, sin reiniciar nada.

## 5. El mismo control, desde un agente (MCP)

En el directorio `demo`, creá `.mcp.json` (Claude Code; Cursor usa la misma
forma):

```json
{
  "mcpServers": {
    "laqi": {
      "command": "node",
      "args": ["<ruta-al-repo-de-laqi>/apps/cli/dist/index.mjs", "mcp"]
    }
  }
}
```

Abrí Claude Code en `demo` y pedile cosas como:

> "haz que `/orders` devuelva el error con 2 segundos de latencia"
> "crea un endpoint `GET /profile` que devuelva un usuario de ejemplo"
> "activa el escenario todo-roto"
> "importa este spec de OpenAPI como mocks"

Las nueve herramientas (`list_endpoints`, `set_response`, `set_scenario`,
`create_endpoint`, `import_openapi`, …) escriben los mismos archivos que el
panel — podés dejar el panel abierto y ver los cambios del agente aparecer en
vivo. Funciona incluso con laqi apagado: los mocks quedan listos para cuando
lo prendas.

## 6. URL pública

Necesita [`cloudflared`](https://github.com/cloudflare/cloudflared) en el
PATH (`brew install cloudflared` — sin cuenta ni login):

```bash
laqi --share
```

```
🌐 EXPOSED TO THE INTERNET  https://<algo>.trycloudflare.com
   mocks only — the panel and the control plane stay on 127.0.0.1:8000

   token  3f9a…
   curl -H 'Authorization: Bearer 3f9a…' https://<algo>.trycloudflare.com/
```

Tres cosas para verificar vos mismo:

```bash
# 1. Los mocks salen, con el token:
curl -H 'Authorization: Bearer <token>' https://<algo>.trycloudflare.com/users
# 2. Sin token: 401.
curl https://<algo>.trycloudflare.com/users
# 3. El panel NO existe en la URL pública — 404, aun con token:
curl -H 'Authorization: Bearer <token>' https://<algo>.trycloudflare.com/__laqi/api/status
```

Esa URL sirve para un teléfono físico con React Native, Expo Go sobre datos
móviles, o un compañero en otra red. El panel se sigue usando en tu
`localhost` y los flips se reflejan al instante en la URL pública.

## 7. Un frontend de verdad contra el mock

Todo lo anterior fue curl y el panel. Para ver laqi haciendo su trabajo real,
está [`examples/todo-app`](https://github.com/csdev19/laqi/tree/main/examples/todo-app):
una app TanStack Start con lista de todos paginada, CRUD, perfil y login.

Dos terminales, desde `examples/todo-app`:

```bash
bun run mock   # laqi + su panel
bun run dev    # el frontend
```

Abrí el panel al lado de la app y flipeá respuestas mientras la usás. Nada se
reinicia:

| Flipeá esto | Y la app… |
| --- | --- |
| `GET /todos` → `error` | muestra su estado de error con botón de reintentar |
| `GET /todos` → `empty` | muestra el estado vacío |
| `GET /todos` → `one-page` | baja a tres items y el paginador desaparece |
| `GET /todos` → `slow` | muestra el loading, sostenido 2.5s |
| `GET /profile` → `unauthorized` | cierra sesión, como haría un 401 real |
| escenario `backend-caido` | rompe todos los endpoints de golpe |

Ésos son justamente los estados que cuesta alcanzar contra un backend real, y
acá están a un click.

## 8. Migrar un proyecto de v1

Si tenés un proyecto viejo con `mock.config.json` / `mock-data/`:

```bash
laqi migrate --dry-run   # muestra el laqi.json resultante sin escribir
laqi migrate             # lo escribe
```

## Si algo no anda

- **`/__laqi` muestra "not built yet"** → corriste desde el fuente sin
  construir el panel: `bun run build --filter=@laqi/editor` (el binario de
  `dist/` no tiene este problema).
- **Un archivo de mocks roto** no tumba el servidor: el resto se sigue
  sirviendo, y el panel muestra la banda roja con archivo, línea y causa.
- **`--share` pide cloudflared** → el mensaje de error trae el comando de
  instalación por plataforma.
- **El puerto está ocupado** → `laqi --port 8001`.
