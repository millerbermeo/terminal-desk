# ⚠️ Cosas obligatorias (no olvidar)

Lista corta de lo que **hay que hacer a mano** para que Odesk Agent funcione entre varias computadoras. Si algo falla "raro", empieza por aquí.

## 1. Subir `.odesk/project.json` a git — en CADA proyecto

Es el archivo que dice a qué proyecto del servidor corresponde una carpeta. Contiene solo un `projectId`; sin él, la otra computadora **no sabe qué proyecto es**, no baja las tareas ni las conversaciones y crea uno nuevo vacío.

```bash
cd <carpeta-del-proyecto>
git add .odesk/project.json
git commit -m "chore: enlace con Odesk Agent"
git push
```

- La app te lo recuerda al agregar un proyecto nuevo si el archivo aún no está en git (y avisa con más fuerza si un `.gitignore` lo excluye).
- **No lo metas en `.gitignore`.** Comprobación rápida: `git ls-files .odesk/project.json` debe devolver la ruta.
- Un proyecto = un archivo. Si copias una carpeta con su `.odesk/` para hacer otro proyecto distinto, bórrala antes en la copia o ambos compartirán tareas y chats.
- En la computadora 2: `git pull` → *Abrir carpeta* en la app. El proyecto se retoma solo.

## 2. El servidor (API) tiene que estar en marcha

La app ya no guarda proyectos ni agentes en local: sin API no hay sesión ni proyectos.

- Local: en `terminal-desk-api` → `pnpm dev` (`http://localhost:3000`).
- Servidor propio (VPS): ver la sección *Despliegue* del README de `terminal-desk-api`. Para apuntar la app a él: pantalla de acceso → **cambiar** servidor, o `servidor.json` en `~/.odesk-agent/`, o la variable `ODESK_API_URL`. **Usa https**: con http viajan las contraseñas sin cifrar.

## 3. Migraciones antes de arrancar una versión nueva del API

```bash
cd terminal-desk-api
pnpm migration:estado     # qué falta aplicar
pnpm migration:ejecutar   # aplica las pendientes
```

Una migración ya aplicada **no se edita**: el cambio va en una migración nueva (`pnpm migration:crear <nombre>`).

## 4. Copias de seguridad de Postgres

Todo (proyectos, tareas, conversaciones, trazas, agentes) vive ahora en la base de datos del servidor. Programa un `pg_dump` periódico y guarda las copias fuera del servidor:

```bash
pg_dump -h localhost -U postgres -Fc desk > desk-$(date +%F).dump
```

## 5. Correo (SMTP) para los códigos

Crear cuenta y recuperar la contraseña funcionan con un código que llega por correo. En el `.env` del API rellena `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` y `SMTP_FROM` (Gmail con contraseña de aplicación, Resend, Brevo, Amazon SES…). Sin SMTP, en desarrollo el código aparece en la consola del API; **en producción el API no arranca sin SMTP**.

## 6. Secretos del API (`terminal-desk-api/.env`)

- `JWT_SECRET`: propio, aleatorio y de al menos 32 caracteres (`openssl rand -hex 32`). El API no arranca con el valor de ejemplo. Cambiarlo cierra todas las sesiones.
- `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET`: solo si quieres «Continuar con Google» (cómo obtenerlos: README del API). En producción cambia también `GOOGLE_CALLBACK_URL` a tu dominio y regístralo en Google.
- El `.env` nunca se sube a git.

## 7. Varias cuentas en el mismo equipo

Los datos locales (tareas, conversaciones, memoria, token de GitHub, proveedores con sus claves, historial del navegador integrado…) son de la cuenta que entró. Al entrar con **otra** cuenta, la app los aparta en `~/.odesk-agent/perfiles/` y **se reinicia sola** una vez; al volver la primera, recupera lo suyo. La primera cuenta que entra tras actualizar adopta lo que ya había.

Lo que **no** se separa por cuenta: el login de Claude Code (`~/.claude`, es del usuario del sistema), los worktrees y el propio código de tus carpetas. Para separación total, usa un usuario del sistema operativo por persona.

## 8. Frase de la bóveda de claves (si la activas)

Las claves de API (proveedores de IA, servidores MCP), el cliente API y el token de GitHub viajan a tus otros equipos **cifrados en tu equipo** con una frase que solo tú conoces (panel **Cuenta → Claves en la nube**). El servidor no puede leerlas. **Si olvidas la frase, lo guardado en la bóveda no se puede recuperar**: guárdala en tu gestor de contraseñas. En cada equipo nuevo: Cuenta → Desbloquear con la frase.

## Qué se guarda en la nube y qué no

| Se guarda en tu cuenta (servidor) | Cómo |
|---|---|
| Proyectos, grupos, agentes y skills | Solo en el servidor |
| Tareas (de proyecto y sueltas), columnas del tablero | Copia local + sincronización |
| Conversaciones y trazas del asistente (y sus borrados) | Copia local + sincronización |
| Memoria, permisos, comandos `/`, preferencias | Copia local + sincronización |
| Proveedores de IA y servidores MCP (sin claves) | Copia local + sincronización |
| Claves de proveedores y MCP, cliente API, token de GitHub | Bóveda cifrada con tu frase (opcional) |

Se sincroniza solo cada 30 segundos (y al entrar y al cerrar la app); también hay **Cuenta → Sincronizar ahora**. Si cambias lo mismo en dos equipos, gana el cambio más reciente. Sin conexión la app sigue funcionando con su copia local y sube los cambios al volver la red.

**Se queda en cada equipo** (a propósito): las rutas de tus carpetas, la sesión, los worktrees, las terminales, el login de Claude Code (`~/.claude`), el uso de tokens, los informes de evals y los adjuntos.

«Quitar» un proyecto solo lo suelta de ese equipo; en el servidor se conserva.
