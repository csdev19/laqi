# ADR-0004 — El estado activo no se trackea

**Estado:** Aceptada
**Fecha:** 2026-08-24

## Contexto

En v1, el campo `codeResponse` vivía **dentro del archivo de mock**, que se
commitea:

```json
{
  "post": {
    "method": "GET",
    "codeResponse": "200",        <-- el estado activo, dentro del archivo commiteado
    "responses": [ ... ]
  }
}
```

Ese campo mezcla dos cosas de naturaleza distinta:

- **Definición** — qué respuestas existen. Estable, se comparte, tiene sentido en git.
- **Estado** — cuál está activa ahora. Volátil, personal, cambia cuarenta veces
  por tarde.

Con el editor web y el MCP escribiendo sobre esos mismos archivos, había que
decidir dónde vive el estado.

## Decisión

**La definición se commitea. El estado activo no se trackea.**

```
laqi.json               definición + "default"       commiteado
laqi/scenarios.json     escenarios con nombre        commiteado
.laqi/state.json        estado activo                gitignored, autocreado
X-Laqi-Response         override por request         sin estado
```

El detalle de precedencia está en
[resolución de estado](../conceptos/resolucion-de-estado.md).

**Nota importante:** el estado **sí se persiste** a disco. La decisión no es
"guardar o no guardar", es **dónde**: en un archivo aparte que no va a git, no
dentro del archivo commiteado.

## Qué se pierde si el estado vive en el archivo commiteado

**1. El diff sucio, todos los días.**

Le muestras a la diseñadora el 401, después el 500, después vuelves al 200. Tres
modificaciones a `laqi.json`. Ahora `git status` está sucio y hay que decidir: si
commiteas, le empujas tu estado de demo a todo el equipo; si no commiteas, se
queda en el working tree para siempre y choca en cada `pull`. No hay salida
buena — es fricción diaria por algo que no es código.

**2. Conflictos de merge que no significan nada.**

Dev A commitea `"default": "boom"` porque estaba probando errores. Dev B
commitea `"default": "empty"`. Conflicto. Un conflicto de merge debería
significar "dos personas tocaron la misma lógica"; acá no significa nada, y eso
entrena al equipo a resolver conflictos en piloto automático — el hábito que hace
que un día se pierda un cambio real.

**3. La URL pública se vuelve de un solo usuario.** ← la razón decisiva

Específico de la feature que justifica v2. Levantas el túnel y compartes la URL.
Estás probando tu pantalla de error, así que pones `POST /orders` en 500.

En ese mismo momento **la diseñadora está viendo la demo en su teléfono, contra
esa misma URL, y le sale 500.** Y tu compañero de backend validando contratos,
también.

Con un campo global, el mock compartido tiene un solo estado a la vez — y
compartirlo era la mitad de la razón para tener la URL. Con el header
`X-Laqi-Response` cada quien declara lo que quiere y nadie pisa a nadie.

**4. Los tests e2e se serializan.**

Un test de Playwright que necesita el 500 tiene que mutar estado global, así que
ningún otro test puede correr en paralelo mientras tanto. Con header, cada test
pide lo suyo y corren todos juntos.

## Qué cuesta esta decisión

Lo justo es decirlo:

**1. El estado deja de viajar en el repo.**

En v1, commitear `codeResponse: "error401"` hacía que tu compañero clonara y
reprodujera tu setup exacto. Eso es una capacidad real.

**No se pierde: eso son los escenarios.** `scenarios.json` sí se commitea, tiene
nombre, y `laqi scenario checkout-roto` reproduce el mismo estado. Es la misma
capacidad, explícita y nombrada en vez de implícita y accidental — en v1 lo
compartías por accidente, acá lo compartes a propósito.

**2. Un concepto y un archivo más.** Costo real. Se mitiga con que es gitignored,
se autocrea, y nunca se abre a mano: lo manejan el editor y el MCP.

**3. Abrir `laqi.json` ya no dice qué está activo.** También real. Se mitiga con
`laqi status`, con el log de arranque del servidor, y con el editor web.

**4. Dos lugares donde mirar cuando algo devuelve raro.**

El costo más molesto, y tiene solución limpia: laqi devuelve en **cada** respuesta
un header diciendo qué capa decidió.

```
X-Laqi-Resolved: boom (state)      ← lo puso el editor
X-Laqi-Resolved: ok (default)      ← nadie tocó nada
X-Laqi-Resolved: boom (header)     ← lo pidió este request
```

Se abre el devtools y se ve de dónde salió la respuesta. El problema desaparece.

## Alternativas consideradas

**Estado dentro del mock, como v1.** Más simple, un solo archivo, cero conceptos
nuevos, y el estado se comparte por git. Descartada por los cuatro puntos de
arriba — sobre todo el tercero, que rompe la feature central de v2.

Sería la decisión correcta si laqi fuera para un dev, en una máquina, sin URL
compartida, sin editor y sin IA. Ése ya no es el laqi que se está construyendo:
los tres pilares del rewrite son justamente los tres casos donde el estado global
duele.

**Sólo en memoria, sin persistir.** Git queda igual de limpio que con el archivo
aparte, pero armas un setup de demo tocando ocho endpoints, haces Ctrl-C y
perdiste el trabajo. Es estrictamente peor que el archivo aparte por el precio de
un `JSON.stringify` — se paga el costo sin ganar nada. Descartada.

## Consecuencias

**A favor:**
- Git limpio; los diffs de los mocks sólo muestran cambios de definición reales.
- La URL pública sirve a varias personas con estados distintos.
- Los tests e2e corren en paralelo.
- El editor web y el MCP escriben sin ensuciar el working tree.

**En contra:**
- Un archivo y un concepto más que aprender.
- Hay que implementar `X-Laqi-Resolved` y `laqi status` para que la trazabilidad
  no se degrade. **No son opcionales**: sin ellos, el costo 4 vuelve.

## Puerta de salida

`.laqi/state.json` está gitignored **por convención, no por obligación**. Sacarlo
del `.gitignore` y commitearlo es una línea, si algún equipo decide que quiere el
estado compartido por git.
