# Rutas Mapit a GPX (web)

Exporta en bloque todas tus rutas de Honda Mapit a GPX desde el navegador. Es la versión web de `mapit_export.py`. No guarda contraseñas ni rutas.

## Privacidad

| Dato | Destino | ¿Se guarda? |
|---|---|---|
| Correo y contraseña | Directamente a Amazon Cognito (el login de Mapit), desde tu navegador | No. El campo se vacía al enviar y `login()` no la retiene |
| Claves temporales (≈1 h) y rutas | API de Mapit, directo desde el navegador; si Mapit bloquea CORS, vía `api/proxy.js` | No |
| GPX | Memoria de la pestaña hasta que descargas | No: sin cookies, `localStorage`, analítica ni terceros |

Cómo está garantizado:

- **Sin dependencias ni CDN.** Todo el JS es propio (`public/js`), incluido el ZIP. No se cargan fuentes ni scripts externos.
- **CSP estricta** (`vercel.json`): el navegador solo puede conectar con esta web, `*.amazonaws.com` y `*.mapit.me`.
- **`api/proxy.js` es opcional y sin estado:** solo GET, solo `https://*.mapit.me`, solo desde la propia web, sin logs ni caché. La URL viaja en el cuerpo POST para no quedar en los registros de peticiones de Vercel. Nunca recibe la contraseña.
- **`api/config.js`** solo lee la configuración pública de `app.mapit.me` (ids de Cognito y URLs). No recibe datos tuyos.
- La web indica en pantalla si usa conexión directa o el reenvío.

Verifícalo tú mismo: abre las herramientas de desarrollo, pestaña Red, y comprueba que la contraseña solo aparece en la petición a `cognito-idp.*.amazonaws.com`.

## Despliegue

1. Sube este contenido a un repositorio de GitHub (la carpeta `public`, `api`, `package.json` y `vercel.json` en la raíz).
2. En Vercel: **Add New → Project**, importa el repo. Framework: *Other*. Sin build command. Vercel toma `outputDirectory: public` de `vercel.json`.
3. Despliega. Cada `git push` a `main` redespliega.

Si quieres tipografías de marca sin peticiones externas, añade los `.woff2` en `public/fonts/` y declara `@font-face` en `styles.css` (la CSP ya permite `font-src 'self'`).

## Uso

1. Conecta con tu correo y contraseña de Mapit.
2. Elige moto y rango de meses. Para probar, límite de 1 ruta.
3. Pulsa **Exportar a GPX** y descarga los archivos sueltos o el ZIP.
4. La sesión de Mapit dura aproximadamente una hora. Si caduca, vuelve a conectar y continúa: no repite las rutas ya guardadas.
5. **Cerrar sesión y borrar** vacía la memoria.

## Notas

- Usa la API no documentada de Mapit (la misma que `app.mapit.me`); puede cambiar sin aviso.
- La verificación de la firma SigV4 se probó con el vector de pruebas oficial de AWS. La conexión real con Mapit solo puede validarse con tu cuenta.
- Cuentas que entran solo con Google o Apple no tienen contraseña: crea una desde «Olvidé mi contraseña» en app.mapit.me.
