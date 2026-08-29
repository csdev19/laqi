---
title: "ADR-0007 — URL pública: cloudflared primero, relay propio después"
---

# ADR-0007 — URL pública: cloudflared primero, relay propio después

**Estado:** Aceptada
**Fecha:** 2026-08-24

## Contexto

El problema original que motivó esta parte del rewrite: **en React Native no
puedes usar `localhost` como backend confiable.** El dispositivo físico no
resuelve el `localhost` de tu máquina, Expo Go sobre datos móviles no ve tu red
local, y un compañero en otra red no llega a tu mock.

v1 lo intentaba con el campo `ip` de `mock.config.json`, para bindear a la IP de
LAN. Eso funciona sólo si el dispositivo está en la misma wifi, se rompe cada vez
que el router reasigna la IP, y no sirve para compartir con nadie fuera de la
oficina.

## Decisión

Un flag `laqi --share` que levanta una **URL pública** apuntando al mock local.

**Fase 1:** envolver `cloudflared`.
**Fase 2 (después, si el uso lo justifica):** relay propio en Cloudflare Workers,
con subdominios estables.

La capa de compartición se diseña como **interfaz enchufable** (`TunnelProvider`)
desde el día uno, para que la fase 2 no exija reescribir nada.

## Por qué cloudflared primero

`cloudflared tunnel --url http://localhost:8000` da una URL `*.trycloudflare.com`
gratis, sin cuenta, sin límite de sesión y **sin página interstitial** — a
diferencia del tier gratuito de ngrok y de localtunnel, que meten una pantalla
intermedia que rompe cualquier cliente que no sea un navegador. Para una app de
React Native consumiendo una API, ese interstitial es un bloqueante absoluto.

Cero infraestructura propia, y se implementa en días en vez de semanas.

**Limitaciones aceptadas:** URL aleatoria en cada arranque, y dependencia de un
binario externo que hay que detectar o descargar.

## Por qué el relay propio después, y no ahora

Un Worker de Cloudflare con un Durable Object que mantiene un WebSocket contra el
CLI y hace proxy de HTTP público → WS → servidor local. Da `<slug>.laqi.dev`,
subdominios estables, cero terceros, y a escala hobby cuesta prácticamente nada.
Con Hono es directo, y `rakoi-monorepo` ya tiene `packages/infra-cloudflare` y
`@cloudflare/workers-types`, así que el terreno está pisado.

**Se pospone porque es infraestructura de verdad**: dominio, cuenta, operación,
y a partir de ahí eres responsable de un servicio que otros usan. No vale la pena
antes de saber si alguien usa `--share`.

Lo que sí se hace ahora es **no cerrarse la puerta**: `TunnelProvider` como
interfaz, con `CloudflaredProvider` como primera implementación.

## Seguridad: no negociable

Ésta es la parte crítica. El [análisis de v1](/v1-analysis/) mostró que el
servidor tenía CORS `*` y cero autenticación. En `127.0.0.1` daba igual. **Con
URL pública deja de dar igual**, y las URLs de túnel efímero son escaneadas
activamente por bots.

Cuando `--share` está activo:

1. **Token obligatorio por defecto.** El CLI genera un token, lo imprime al
   arrancar, y todo request sin `Authorization: Bearer <token>` recibe 401.
   Desactivarlo exige un flag explícito (`--share --public`) que imprime una
   advertencia.
2. **CORS restringido.** Nunca `*` en modo compartido. Sólo los orígenes
   declarados en la config.
3. **El editor web y el MCP no se exponen.** `/__laqi` y el control plane quedan
   atados a la interfaz local, nunca al túnel. Que alguien tenga la URL del mock
   no puede significar que pueda reescribir tus mocks.
4. **Rate limiting** sobre la superficie pública.
5. **Aviso claro al arrancar**, diciendo qué quedó expuesto y con qué token.

## Alternativas consideradas

**ngrok.** El más conocido, pero el tier gratuito exige authtoken, limita
sesiones y mete página interstitial. Descartado por el interstitial.

**localtunnel.** Puro JS, sin binario externo, instalable como dependencia — muy
atractivo por eso. Descartado por fiabilidad histórica irregular y por mostrar
también una página intermedia.

**Tailscale Funnel.** Sólido, pero exige que todos los participantes tengan
Tailscale. Choca con "compartirle la URL a la diseñadora".

**No hacer túnel; sólo bindear a la IP de LAN (lo de v1).** Descartada: no
resuelve Expo Go sobre datos móviles, ni un compañero en otra red, ni un
dispositivo físico en otra wifi. Es exactamente el problema que motivó todo esto.
Se mantiene igual como opción para el caso simple de misma-wifi.

## Consecuencias

**A favor:**

- Resuelve el problema real de React Native.
- Convierte al mock en algo compartible: la diseñadora ve la demo desde su
  teléfono, el backend valida contratos contra la misma URL.
- Cero infraestructura propia en fase 1.

**En contra:**

- Dependencia de un binario externo (`cloudflared`): detectar, guiar la
  instalación o descargarlo.
- URL distinta en cada arranque hasta que exista el relay propio.
- **Obliga a tomarse la seguridad en serio.** Las cinco medidas de arriba son
  trabajo real que sin `--share` no haría falta. Es el costo de la feature.
- El modo compartido **sólo funciona bien porque el estado no es global**
  ([ADR-0004](/decisions/0004-state-outside-git/)). Las dos decisiones se sostienen
  mutuamente.
