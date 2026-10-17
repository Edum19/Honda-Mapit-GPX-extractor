# Mapit to GPX

Herramienta web para exportar en bloque todas tus rutas de **Honda Mapit** a archivos **GPX**, pensada para la privacidad: no guarda contraseñas, ni rutas, ni nada en el servidor.

> Proyecto independiente y no oficial. Consulta el [aviso legal](#aviso-legal).

## Qué hace

- Inicia sesión con tu cuenta de Mapit y lista tus motos y rutas.
- Convierte cada ruta a GPX 1.1 (pistas, marcadores de salida y llegada, marcas de tiempo).
- Descarga las rutas sueltas o todas juntas en un ZIP.
- Funciona en el navegador, en escritorio y en móvil. No hay que instalar nada.

## Privacidad

| Dato | Destino | ¿Se guarda? |
|---|---|---|
| Correo y contraseña | Directamente a Amazon Cognito (el servicio de acceso de Mapit), desde tu navegador | No. El campo se vacía al enviar y el código no la retiene |
| Claves temporales (caducan en ≈1 h) y rutas | API de Mapit, directo desde el navegador. Si Mapit bloquea ese acceso (CORS), pasan por `api/proxy.js` | No |
| Archivos GPX | Memoria de la pestaña hasta que los descargas | No: sin cookies, `localStorage`, analítica ni terceros |

Cómo se garantiza, y cómo puedes comprobarlo:

- **Sin dependencias ni recursos externos.** Todo el JavaScript es propio (`public/js`), incluido el generador de ZIP. No se cargan fuentes, scripts ni analítica de terceros.
- **CSP estricta** (`vercel.json`): el navegador solo puede conectar con el propio sitio, `*.amazonaws.com` y `*.mapit.me`.
- **Reenvío opcional y sin estado.** `api/proxy.js` solo acepta GET hacia `https://*.mapit.me`, solo desde el propio sitio, sin logs ni caché. La URL de destino va en el cuerpo de un POST para no aparecer en registros de peticiones. Nunca recibe la contraseña.
- **Configuración pública.** `api/config.js` solo lee los identificadores públicos de `app.mapit.me`. No recibe datos del usuario.
- **Transparencia en pantalla.** La web indica si usa conexión directa o el reenvío.
- **Compruébalo tú.** Abre las herramientas de desarrollo, pestaña Red: la contraseña solo aparece en la petición a `cognito-idp.*.amazonaws.com`. El código es corto y está pensado para auditarse.

## Cómo funciona

Es el mismo flujo que usa la web oficial de Mapit:

1. Lee la configuración pública (ids de Cognito y URLs de la API) del código de `app.mapit.me`.
2. Inicia sesión en Cognito con `USER_PASSWORD_AUTH`.
3. Cambia el token por credenciales temporales de AWS (Cognito Identity).
4. Consulta la API con peticiones GET firmadas con AWS SigV4 (firma implementada con Web Crypto y verificada con el vector de pruebas oficial de AWS).
5. Convierte el GeoJSON de cada ruta a GPX.

## Zonas horarias

- Los archivos GPX guardan siempre las marcas de tiempo en **UTC**, que es lo que esperan las aplicaciones.
- Las fechas que se muestran en pantalla y en los nombres de archivo usan la **zona horaria del dispositivo** (la del sistema operativo, sin pedir ubicación) o UTC, a elegir. La hora de verano se aplica sola.
- Si descargas rutas hechas en otro huso, se muestran en tu zona actual y con su desfase (por ejemplo `CEST`), de forma que no hay ambigüedad.

## Estructura

```
public/            web estática (HTML, CSS y JS sin dependencias)
  js/mapit.js      login, firma SigV4 y llamadas a la API
  js/gpx.js        conversión GeoJSON a GPX
  js/zip.js        generador de ZIP
  js/app.js        interfaz
api/config.js      lectura de la configuración pública de Mapit
api/proxy.js       reenvío opcional y sin estado
vercel.json        cabeceras de seguridad (CSP, referrer, etc.)
```

## Limitaciones

- Usa la API no documentada de Mapit, la misma que su web. Puede cambiar sin aviso.
- La sesión de Mapit dura aproximadamente una hora. Si caduca, vuelve a conectar y continúa sin repetir lo ya exportado.
- Las cuentas que solo entran con Google o Apple no tienen contraseña: crea una desde «Olvidé mi contraseña» en app.mapit.me.
- Solo exporta rutas de tu propia cuenta.

## Contribuir

Las incidencias y pull requests son bienvenidas. Si abres una incidencia, **no pegues nunca** contraseñas, tokens ni coordenadas de tus rutas.

## Aviso legal

Este es un proyecto independiente y no oficial. No está afiliado, patrocinado ni respaldado por Honda ni por Mapit. Honda, Mapit y sus logotipos son marcas de sus respectivos titulares y se citan únicamente para indicar con qué servicios es compatible la herramienta.

Las rutas que descargas son datos de tu cuenta: úsalas conforme a las condiciones de servicio de Mapit. El software se ofrece «tal cual», sin garantía de ningún tipo, y su uso es responsabilidad de quien lo utiliza.

## Licencia

[MIT](LICENSE). © 2026 Edum19.
