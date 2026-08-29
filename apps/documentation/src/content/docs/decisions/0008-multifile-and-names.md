---
title: "ADR-0008 — Multi-archivo con claves `\"METHOD /path\"`, y nombres"
---

# ADR-0008 — Multi-archivo con claves `"METHOD /path"`, y nombres

**Estado:** Aceptada
**Fecha:** 2026-08-24
**Supera:** la parte de routing por filesystem del [ADR-0003](/decisions/0003-declarative-json/)

## Contexto

El [ADR-0003](/decisions/0003-declarative-json/) definió dos modos: un archivo único con
claves `"METHOD /path"`, o una carpeta con **routing por filesystem**
(`laqi/users/[id].json`), elegido para que la colisión de rutas entre archivos
fuera imposible por construcción — el defecto D de v1.

El diseño del control panel asumió otra cosa: una carpeta con **varios archivos
normales**, todos usando claves `"METHOD /path"` (visible en la banda de error
—`mocks/orders.json:14:7`— y en el flujo F6, que agrega a `mocks/api.json`).

Eso reabre la colisión: dos archivos pueden definir `"GET /users"`.

Además el diseño usa `./mocks/` como nombre de carpeta, distinto del `laqi/` del
ADR-0003.

## Decisión

**1. Un solo formato de clave, en cualquier cantidad de archivos.**

```
laqi/
├── api.json          { "GET /users": {...}, "POST /users": {...} }
├── orders.json       { "GET /orders": {...} }
└── scenarios.json    escenarios con nombre
```

Sin routing por filesystem. La ruta HTTP sale siempre de la clave, nunca de la
ubicación del archivo. Los archivos son puramente organizativos.

**2. La colisión se resuelve con validación, no con estructura.**

Una ruta duplicada entre archivos es un **error de carga** que aparece en la
banda roja del panel, nombrando ambos orígenes:

```
LOAD FAILED   duplicate route GET /users
              laqi/api.json:2  and  laqi/orders.json:14
```

Igual que un JSON inválido: ruidoso, con archivo y línea, y **no fatal** — el
resto del mock se sigue sirviendo (ver ADR-0003 y la corrección de semántica en
[three-writers](/concepts/three-writers/)).

**3. Nombres.**

| Ruta                  | Qué es                         | Git            |
| --------------------- | ------------------------------ | -------------- |
| `laqi.json`           | Modo archivo único, en la raíz | commiteado     |
| `laqi/`               | Modo carpeta                   | commiteado     |
| `laqi/scenarios.json` | Escenarios con nombre          | commiteado     |
| `.laqi/state.json`    | Estado activo                  | **gitignored** |

La regla, en una línea: **sin punto es tuyo y se commitea; con punto lo genera
la máquina y se ignora.**

**4. Los escenarios se escriben a mano y por MCP.**

El flujo F4 del diseño deja la autoría de escenarios fuera del panel a propósito
(el panel sólo activa). Se confirma esa decisión, y se cubre el hueco por el
otro lado: el [ADR-0006](/decisions/0006-mcp-server/) suma `create_scenario` y
`update_scenario` a las herramientas MCP. El agente es quien mejor sabe qué
endpoints toca un escenario, porque tiene el contexto de la pantalla que está
construyendo.

## Por qué se cede ante el diseño en el punto 1

**El objetivo del ADR-0003 era que no hubiera colisiones _silenciosas_.** La
estructura era un medio para lograrlo, no el fin. La validación consigue lo
mismo, y a estas alturas es más barata:

1. **La banda de error ya existe** en el diseño, con archivo, línea, causa en
   palabras y extracto de código. Una colisión encaja ahí sin inventar nada.
2. **Una sola sintaxis de clave** en todos lados. El routing por filesystem
   obligaba a dos modelos mentales: claves con método en modo archivo, métodos
   como claves internas en modo carpeta.
3. **Sin carpetas profundas.** `laqi/api/v1/users/[id]/orders/[orderId].json`
   contra una línea `"GET /api/v1/users/:id/orders/:orderId"`.
4. **El editor y el MCP se simplifican**: crear un endpoint es agregar una clave
   a un archivo, no decidir dónde ponerlo en un árbol.
5. Cada endpoint ya lleva su archivo de origen en el contrato del control plane,
   así que el error puede nombrar los dos lados del conflicto.

## Por qué `laqi/` y no `mocks/`

`mocks/` choca con convenciones que ya existen en proyectos reales: `__mocks__`
es la convención de Jest, y los setups de MSW usan `mocks/` habitualmente.
Alguien que instale laqi en un proyecto con una carpeta `mocks/` previa tendría
un conflicto el primer día.

`laqi/` no colisiona con nada, es corto, y queda simétrico con `laqi.json` del
modo archivo único. El costo —que el nombre diga qué herramienta lo lee en vez
de qué contiene— es menor que el riesgo de pisar una carpeta existente.

**Consecuencia para el diseño:** las pantallas dicen `./mocks/` y
`mocks/api.json`. Hay que cambiar esos strings a `./laqi/` y `laqi/api.json` en
el header, la banda de error, el estado fresh y el flujo F6.

## Alternativas consideradas

**Mantener el routing por filesystem del ADR-0003.** La colisión sería imposible
en vez de sólo detectada, y el idioma es familiar (Next.js, Nuxt, SvelteKit).
Descartada por las cinco razones de arriba, y porque obligaba a reajustar un
diseño ya entregado y bien resuelto.

**Soportar los dos modos.** Filesystem routing si el archivo no tiene claves con
método, claves `"METHOD /path"` si las tiene. Descartada: dos modelos mentales
conviviendo, el editor web tendría que entender ambos, el MCP tendría que elegir
uno al crear, y se duplica la superficie de tests y documentación. Flexibilidad
que nadie pidió.

**`mocks/` como en el diseño.** Descartada por el choque con Jest y MSW.

## Consecuencias

**A favor:**

- Una sola sintaxis en todo el producto: archivos, editor, MCP y documentación.
- El diseño entregado se implementa casi tal cual (sólo cambian nombres de rutas).
- Organizar los mocks es libre: un archivo, uno por recurso, o por feature.

**En contra:**

- **La colisión es posible, sólo que ruidosa.** Se paga con un test que la
  cubra y con un mensaje de error que nombre los dos archivos. Sin ese mensaje,
  esta decisión es peor que la anterior.
- La ruta HTTP ya no se puede deducir mirando el árbol de archivos; hay que
  abrirlos. Se mitiga con el campo `file` por endpoint en el panel.
- Hay que actualizar los strings del diseño.
