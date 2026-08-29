---
title: ADR-0006 — Servidor MCP como pieza de primera clase
---

# ADR-0006 — Servidor MCP como pieza de primera clase

**Estado:** Aceptada
**Fecha:** 2026-08-24

## Contexto

laqi v1 se diseñó para un flujo de trabajo donde el humano escribe los mocks a
mano. Ese ya no es el único flujo: hoy buena parte del frontend se construye con
un agente (Claude Code, Cursor) que tiene el contexto de la pantalla que está
armando.

Cuando ese agente necesita un endpoint, tiene que abrir un JSON, adivinar el
esquema, escribirlo y esperar que el hot-reload lo tome. Y cuando necesitas ver
la pantalla de error, paras, buscas el archivo, cambias un campo y guardas.

## Decisión

**laqi expone un servidor MCP** (`packages/mcp`) como interfaz de primera clase,
al mismo nivel que el CLI y el editor web.

Herramientas expuestas:

| Herramienta       | Qué hace                                                            |
| ----------------- | ------------------------------------------------------------------- |
| `list_endpoints`  | Devuelve la tabla de rutas con sus respuestas disponibles           |
| `create_endpoint` | Crea un endpoint con sus respuestas                                 |
| `update_endpoint` | Modifica definición o respuestas                                    |
| `set_response`    | Cambia la respuesta activa de una ruta (escribe `.laqi/state.json`) |
| `set_scenario`    | Activa un escenario con nombre                                      |
| `get_state`       | Qué está activo ahora y por qué capa                                |
| `import_openapi`  | Genera mocks desde un spec OpenAPI                                  |

## Por qué

**1. Es el escritor que faltaba.**

El argumento completo está en [los tres escritores](/concepts/three-writers/).
El MCP no es una feature añadida: es uno de los tres consumidores que definen el
formato. Diseñar el formato pensando sólo en el humano y agregar MCP después
habría producido un formato hostil para la máquina.

**2. Cambia lo que laqi es.**

Con MCP, el mock deja de ser un archivo que editas y pasa a ser algo que pides:

> "haz que `/orders` devuelva 500 con dos segundos de latencia"
> "crea el endpoint de perfil según el diseño de esta pantalla"
> "activa el escenario de carrito vacío"

El agente ya tiene el contexto de la pantalla. Es el que mejor sabe qué forma
debe tener la respuesta.

**3. La infraestructura ya está.**

El _control plane_ que necesita el editor web —listar rutas, cambiar estado,
crear endpoints— es exactamente el que necesita el MCP. Se implementa una vez en
`core` y se expone por tres superficies: CLI, HTTP (editor) y MCP.

## Alternativas consideradas

**Sólo CLI, que el agente corra comandos.** Funciona a medias: el agente puede
correr `laqi scenario X`. Pero para crear un endpoint tendría que escribir el
JSON a mano, sin conocer el esquema ni recibir errores de validación
estructurados. MCP le da las herramientas tipadas y los errores de vuelta.

**Sólo dejar que el agente edite los archivos.** Es lo que pasa hoy sin MCP.
Funciona, pero el agente adivina el esquema, no sabe si el hot-reload lo tomó, y
no puede cambiar estado sin ensuciar git (ver [ADR-0004](/decisions/0004-state-outside-git/)).

## Consecuencias

**A favor:**

- El flujo "construyo la pantalla y el backend falso aparece solo" se vuelve real.
- El control plane se comparte entre CLI, editor y MCP: una implementación.

**En contra:**

- Superficie de API que mantener y versionar.
- Hay que decidir cómo se lanza el servidor MCP (`laqi mcp` sobre stdio es lo
  más probable) y documentar la configuración para Claude Code y Cursor.
- Un agente con estas herramientas puede escribir archivos del proyecto. Debe
  estar acotado estrictamente al directorio de mocks — nunca fuera (ver el
  defecto 4.4 del [análisis de v1](/v1-analysis/)).
