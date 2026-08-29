---
title: Resolución de estado
---

# Resolución de estado

**Fecha:** 2026-08-24

Cómo decide laqi v2 **qué respuesta devolver** cuando un endpoint tiene varias
declaradas. Es el sucesor del campo `codeResponse` de v1, y la razón por la que
existe está en [ADR-0004](/decisions/0004-state-outside-git/).

## El problema

Un endpoint declara varias respuestas posibles:

```json
{
  "GET /users": {
    "default": "ok",
    "responses": {
      "ok":    { "status": 200, "body": [{ "id": 1, "name": "Ada" }] },
      "empty": { "status": 200, "body": [] },
      "boom":  { "status": 500, "delay": 2000, "body": { "code": "INTERNAL" } }
    }
  }
}
```

En v1 había un solo lugar donde decir cuál está activa (`codeResponse`, dentro
del archivo), y por lo tanto un solo estado global para todo el mundo. Eso rompe
en tres escenarios que v2 sí tiene que soportar: la URL compartida entre varias
personas, los tests e2e en paralelo, y el editor web cambiando cosas en caliente.

## Las tres capas

De mayor a menor precedencia:

```
1. Header del request     X-Laqi-Response: boom          ← gana siempre, no toca estado
2. Estado activo          .laqi/state.json (gitignored)  ← lo escriben el editor web y el MCP
3. Default                "default": "ok" en el mock     ← commiteado, es la baseline
```

### Capa 1 — Header por request

```
X-Laqi-Response: boom               fuerza una respuesta puntual
X-Laqi-Scenario: checkout-roto      aplica un escenario completo a este request
```

No muta nada. Es lo que hace posible:

- **Tests e2e en paralelo.** Cada test declara la respuesta que necesita en su
  propio request. Sin estado global que sincronizar, sin suite serializada.
- **Varias personas en la misma URL pública.** Tú mandas `X-Laqi-Response: boom`
  desde tu app y ves el 500; la diseñadora, en el mismo túnel, sigue viendo el 200. En v1 esto era imposible.

### Capa 2 — Estado activo

`.laqi/state.json`, gitignored, autocreado. Es lo que cambian el editor web y el
MCP:

```json
{
  "scenario": "checkout-roto",
  "overrides": { "GET /users": "boom" }
}
```

`overrides` (por ruta) gana sobre `scenario` (global), porque es más específico.
Persiste entre reinicios: armas un setup de demo tocando ocho endpoints, cierras
el proceso, vuelves y sigue ahí.

### Capa 3 — Default

El campo `default` dentro del mock. Commiteado. Es lo que ve alguien que clona el
repo y corre `laqi` sin haber tocado nada — el estado sano, feliz, del sistema.

## Escenarios

Un escenario es un conjunto de selecciones con nombre, que mueve varios endpoints
de un golpe. Vive en `laqi/scenarios.json` y **sí se commitea**:

```json
{
  "checkout-roto": {
    "POST /orders": "error500",
    "GET /cart":    "empty"
  },
  "usuario-nuevo": {
    "GET /users/:id/orders": "empty",
    "GET /notifications":    "empty"
  }
}
```

```bash
laqi scenario checkout-roto     # o un click en el editor, o una instrucción a la IA
```

Los escenarios son la respuesta a "pero yo quería compartir mi estado con el
equipo". En v1 lo compartías **por accidente** (commiteando `codeResponse`); acá
lo compartes **a propósito**, con un nombre que dice qué representa. Es la misma
capacidad, explícita.

## Trazabilidad: `X-Laqi-Resolved`

El costo de tener tres capas es la pregunta "¿y por qué esto devolvió 500?". Se
resuelve devolviendo la respuesta en un header, en **cada** respuesta:

```
X-Laqi-Resolved: boom (header)      ← lo pidió este request
X-Laqi-Resolved: boom (state)       ← lo puso el editor web o el MCP
X-Laqi-Resolved: boom (scenario:checkout-roto)
X-Laqi-Resolved: ok (default)       ← nadie tocó nada
```

Abres el devtools y ves qué capa decidió. Sin adivinar, sin ir a buscar archivos.

## Algoritmo

```
resolver(ruta, request):
    si request tiene X-Laqi-Response  -> ésa,                 origen "header"
    si request tiene X-Laqi-Scenario  -> la del escenario,    origen "header"
    si state.overrides[ruta]          -> ésa,                 origen "state"
    si state.scenario                 -> la del escenario,    origen "scenario:<n>"
    si no                             -> definicion.default,  origen "default"

    si el nombre resuelto no existe en responses:
        -> 500 con un cuerpo que dice exactamente qué selector faltaba
           (NUNCA colgar la request — ver defecto C del análisis de v1)
```

> Las palabras de capa son exactamente cuatro: `header`, `state`, `scenario` y
> `default`. Un escenario pedido por header reporta `header`, no `scenario`,
> porque no persiste nada — y porque el panel mapea cada palabra a un color.

La última línea es deliberada: el peor bug de v1 era que un selector inexistente
colgaba la conexión. En v2 es un error explícito y ruidoso.
