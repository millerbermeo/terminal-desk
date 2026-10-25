# Pruebas en móviles Android (adb)

El asistente puede usar teléfonos Android **físicos conectados por USB** (también emuladores y adb por wifi) como entorno de prueba, igual que el navegador integrado: «ve» la pantalla como un árbol con refs, toca, escribe, desliza, abre e instala apps, lee los registros y guarda evidencias.

## Qué necesita la persona (una vez)

1. **Platform-Tools** (adb): Android Studio → SDK Manager, o el zip oficial. Odesk busca `adb` en `ODESK_ADB`, el PATH del shell, `ANDROID_HOME`/`ANDROID_SDK_ROOT` y la carpeta por defecto del SDK (`~/Android/Sdk`, `~/Library/Android/sdk`, `%LOCALAPPDATA%\Android\Sdk`).
2. En el teléfono: Opciones de desarrollador (tocar 7 veces «Número de compilación») → **Depuración USB**. En Xiaomi/Redmi/POCO también «Depuración USB (ajustes de seguridad)» para poder simular toques, e «Instalar vía USB» para instalar APK.
3. Conectar el cable (de datos) y **aceptar en el teléfono** el aviso «¿Permitir depuración USB?». Odesk nunca lo salta: si el dispositivo sale `unauthorized`, la IA explica cómo aceptarlo.
4. Linux: si sale `no permissions`, faltan reglas udev (`android-sdk-platform-tools-common`) y el grupo `plugdev`. Lo hace la persona; Odesk no ejecuta `sudo`.

## Herramientas (`movil_*`, servidor MCP `odesk`)

| Herramienta | Riesgo | Qué hace |
| --- | --- | --- |
| `movil_dispositivos` | lectura | Lista dispositivos y su estado (listo, sin autorizar, sin permiso USB, offline…) con qué hacer en cada caso |
| `movil_info` | lectura | Modelo, Android/SDK, pantalla, batería, ABI, app en primer plano |
| `movil_instantanea` | lectura | Pantalla como árbol (`uiautomator dump`) con refs `e1`, `e2`… para lo tocable; contraseñas ocultas |
| `movil_tocar` | escritura | Toque o pulsación larga por ref, texto visible o coordenadas |
| `movil_escribir` | escritura | Texto en un campo (ASCII), con limpiar/enviar |
| `movil_tecla` | escritura | atras, inicio, recientes, enter, borrar… o KEYCODE |
| `movil_deslizar` | escritura | Deslizar por dirección (pantalla o dentro de una lista) o de punto a punto |
| `movil_esperar` | lectura | Hasta que aparezca/desaparezca un texto (≤ 60 s) |
| `movil_captura` | lectura | Imagen para la IA + PNG a tamaño real como evidencia |
| `movil_apps` | lectura | Apps instaladas; detalle con versión, actividad principal y permisos concedidos/denegados |
| `movil_abrir_app` | escritura | Por paquete, actividad o enlace profundo; detecta si se cerró sola (crash) |
| `movil_cerrar_app` | escritura | `am force-stop` |
| `movil_instalar` | escritura | `adb install -r` (ruta relativa = carpeta del proyecto); `-g` solo si se pide `conceder_permisos` |
| `movil_logcat` | lectura | Registros de la app (`--pid`), solo errores, buffer de crash; `guardar` como evidencia |
| `movil_shell` | ejecucion | Comando en el shell del teléfono (usuario `shell`, sin root) |

Los permisos siguen las reglas de siempre: lectura siempre; acciones desde «Aceptar ediciones»; `movil_shell` solo en «Autónomo». **Sin herramientas que borren**, como en git/GitHub: no hay borrar datos ni desinstalar, y `movil_shell` rechaza `pm clear`/`uninstall`, elevar privilegios (`su`, `magisk`, `setenforce`…), comandos que pueden dejar inservible el teléfono y cambios de ajustes de depuración o seguridad.

Tras cada acción se informa de la app en primer plano y se avisa si la app que estaba delante desapareció (y si fue un crash, mirando el buffer `crash`). Evidencias en `~/.odesk-agent/evidencias/movil/<serie>/` (personal de la cuenta, no sale del equipo).

## Cómo está hecho

- `src/shared/movil.ts`: lógica pura y probada (`tests/movil.test.ts`): `adb devices -l`, ayudas por estado, errores de adb traducidos, XML de uiautomator → árbol → instantánea con refs, búsqueda por texto, escape de `input text`, teclas, `wm size`, primer plano y la lista de comandos de shell bloqueados.
- `src/shared/movil-herramientas.ts`: definiciones (en `HERRAMIENTAS_ODESK`, así que llegan por el mismo socket/MCP que tareas, git y navegador).
- `src/main/movil.ts` (`MovilIA`, conectado con `nucleo.conectarMovil` en `index.ts`): `execFile` de adb (sin shell del equipo; lo que va al shell del teléfono va entre comillas), cola por dispositivo, refs por dispositivo hasta la siguiente instantánea, reintentos del volcado y explicación cuando otra herramienta (Appium, Maestro) ocupa UiAutomator.
- `core/herramientas-odesk.ts#ejecutarControlado`: validación común de navegador y móvil; resuelve el APK relativo con la carpeta del proyecto.

## Límites y herramientas especializadas

`input text` solo escribe ASCII. Apps con `FLAG_SECURE` dan capturas negras. Juegos o vistas sin accesibilidad (Canvas, algunos Flutter sin semántica) no salen en la instantánea: usar captura + coordenadas. Para suites grandes o iOS se puede añadir en `~/.odesk-agent/mcp.json` un servidor MCP de Appium o Maestro; mientras lo usen, la instantánea de Odesk avisa de que UiAutomator está ocupado.
