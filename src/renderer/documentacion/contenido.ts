/**
 * Contenido de la pantalla «Guía». Datos puros (sin React) para poder probarlos y extenderlos:
 * cada sección responde qué es la herramienta, para qué sirve y cómo se usa.
 */

export interface Paso {
  titulo: string
  texto: string
}

export interface Bloque {
  titulo: string
  items: string[]
}

export interface Atajo {
  tecla: string
  que: string
}

export type Categoria = 'Empezar' | 'Terminales' | 'Asistente de IA' | 'Herramientas' | 'Referencia'

export interface Seccion {
  id: string
  titulo: string
  /** Clave del icono; la pantalla la traduce a un componente. */
  icono: string
  categoria: Categoria
  /** Una línea para el índice y la búsqueda. */
  gancho: string
  /** Qué es. */
  resumen: string
  /** Dónde se abre dentro de la app. */
  donde?: string
  /** Para qué sirve. */
  paraQue: string[]
  /** Cómo se usa, en orden. */
  pasos: Paso[]
  /** Detalles por tema. */
  bloques?: Bloque[]
  atajos?: Atajo[]
  /** Qué no hace (a propósito), para no buscarlo en vano. */
  limites?: string[]
  /** Ids de otras secciones. */
  relacionadas?: string[]
}

export const SECCIONES: Seccion[] = [
  {
    id: 'que-es',
    titulo: 'Qué es Odesk Agent',
    icono: 'info',
    categoria: 'Empezar',
    gancho: 'Un escritorio para tus proyectos: terminales, IA, tareas, git y pruebas en una ventana',
    resumen:
      'Odesk Agent reúne en una sola ventana lo que normalmente está repartido entre la terminal, el editor, el cliente de git, el gestor de tareas, Postman y el navegador. Cada proyecto es una carpeta de tu equipo; la app abre terminales reales sobre ella, lanza CLIs de IA dentro de esas terminales y ofrece además su propio asistente conectado a la API de Anthropic.',
    paraQue: [
      'Trabajar varios proyectos a la vez sin perder el contexto: una pestaña por grupo, una terminal por proyecto.',
      'Dar trabajo a la IA con límites claros: confirmaciones, permisos guardados y ramas aisladas.',
      'Tener a mano lo que rodea al código: tareas, git y GitHub, peticiones HTTP y el navegador de pruebas.'
    ],
    pasos: [
      { titulo: '1. Entra con tu cuenta', texto: 'Tus proyectos, grupos y biblioteca de agentes viven en el servidor; la pantalla de acceso aparece hasta que hay sesión.' },
      { titulo: '2. Agrega tus proyectos', texto: '«Abrir carpeta» (explorador del sistema) o «Agregar ruta» (escribir o pegar la ruta). Agrúpalos para abrirlos de golpe.' },
      { titulo: '3. Abre un grupo con ▶', texto: 'Se crea una pestaña con una terminal por proyecto del grupo, todas vivas a la vez.' },
      { titulo: '4. Suma la IA cuando la necesites', texto: 'El botón ✦ de cada proyecto abre su CLI (Claude Code…) dentro de la terminal, o el asistente integrado de la app.' }
    ],
    bloques: [
      {
        titulo: 'Las dos formas de usar IA (no son lo mismo)',
        items: [
          'Terminal ✦ con un proveedor: ejecuta el CLI real (Claude Code) dentro de una terminal tuya. Hereda tu PATH y tu sesión, y al salir del CLI la terminal sigue viva.',
          'Asistente integrado: el núcleo propio de la app hablando con la API de Anthropic. Da trazas, memoria, flujos, permisos y confirmaciones; es el que usan las pantallas de Tareas, Versiones y Evals.'
        ]
      }
    ],
    relacionadas: ['cuenta', 'proyectos', 'terminales', 'asistente']
  },

  {
    id: 'cuenta',
    titulo: 'Cuenta y servidor',
    icono: 'servidor',
    categoria: 'Empezar',
    gancho: 'Inicio de sesión, qué vive en el servidor y qué se queda en tu equipo',
    resumen:
      'Proyectos, grupos y la biblioteca de agentes y skills se guardan en el servidor de Odesk, no en un archivo local. La app pide correo y contraseña (o «Continuar con Google») y guarda el token de sesión cifrado con el llavero del sistema.',
    donde: 'Pantalla de acceso al abrir la app · «Cerrar sesión» al pie de la barra lateral',
    paraQue: [
      'Tener los mismos proyectos y grupos en cualquier equipo donde entres con tu cuenta.',
      'Separar lo compartido (proyectos, agentes) de lo privado de tu equipo (terminales, tareas, claves, historial).'
    ],
    pasos: [
      { titulo: '1. Entrar o crear cuenta', texto: 'Correo y contraseña (mínimo 8 caracteres al registrarte), o «Continuar con Google», que abre tu navegador y vuelve a la app. El ojito del campo muestra u oculta la contraseña.' },
      { titulo: '2. Primera entrada', texto: 'Si la cuenta está vacía y tenías un proyectos.json antiguo, la app sube esos proyectos sola.' },
      { titulo: '3. Si la sesión vence', texto: 'La app vuelve a la pantalla de acceso; vuelve a entrar y sigues donde estabas (las terminales se cierran al recargar la ventana).' }
    ],
    bloques: [
      {
        titulo: 'Qué se guarda y dónde',
        items: [
          'En el servidor: proyectos, grupos y la biblioteca de agentes y skills (sus ids son UUID del servidor).',
          'En tu equipo (~/.odesk-agent/): sesión cifrada, proveedores, tareas, memoria, conversaciones, permisos, comandos, trazas, adjuntos, datos del cliente API y worktrees de agentes.',
          'El servidor se elige con la variable ODESK_API_URL (por defecto http://localhost:3000); la pantalla de acceso muestra cuál está en uso.'
        ]
      }
    ],
    relacionadas: ['datos', 'seguridad', 'proyectos']
  },

  {
    id: 'proyectos',
    titulo: 'Proyectos y grupos',
    icono: 'carpeta',
    categoria: 'Empezar',
    gancho: 'Cada proyecto es una carpeta; los grupos los abren juntos en una pestaña',
    resumen:
      'Un proyecto es un nombre con la ruta de una carpeta de tu equipo. Los grupos juntan los proyectos que trabajas a la vez (por ejemplo Backend, Frontend y Mobile de un mismo producto) y son la unidad con la que se abren pestañas y se activan agentes.',
    donde: 'Barra lateral (lista) · «Configurar proyectos» al pie',
    paraQue: [
      'Abrir de una vez todas las terminales de un producto, cada una en su carpeta.',
      'Activar agentes y skills para todo un grupo en lugar de proyecto por proyecto.',
      'Dar contexto a la IA: el asistente de un proyecto trabaja confinado a su carpeta.'
    ],
    pasos: [
      { titulo: '1. Agregar', texto: '«Abrir carpeta» abre el explorador del sistema y admite varias carpetas; «Agregar ruta» acepta una ruta escrita o pegada, con autocompletado. En ambos casos eliges nombre y grupo antes de guardar.' },
      { titulo: '2. Organizar', texto: 'En «Configurar proyectos» creas grupos, mueves proyectos entre ellos, renombras y eliminas. Los proyectos sin grupo aparecen en «Sin grupo».' },
      { titulo: '3. Abrir', texto: 'Clic en el proyecto abre (o enfoca, si ya existe) su terminal. ▶ en la cabecera del grupo abre la pestaña del grupo con una terminal por proyecto; si vuelves a pulsarlo, reabre solo las que falten.' },
      { titulo: '4. Clonar desde GitHub', texto: 'Si el proyecto aún no está en tu equipo, el botón «Clonar» de la pantalla Versiones lo descarga, lo agrega como proyecto y lo abre.' }
    ],
    bloques: [
      {
        titulo: 'Detalles útiles',
        items: [
          'La insignia de un proyecto cuenta sus terminales abiertas; el punto verde del grupo indica que su pestaña está abierta.',
          'Un clic nunca duplica terminales: para tener dos del mismo proyecto usa «+ Terminal» o el menú ✦.',
          'Eliminar un grupo pide la contraseña de tu usuario del sistema (es una acción que afecta a todo lo activado en él).'
        ]
      }
    ],
    relacionadas: ['terminales', 'agentes-skills', 'versiones']
  },

  {
    id: 'terminales',
    titulo: 'Terminales, pestañas y rejilla',
    icono: 'terminal',
    categoria: 'Terminales',
    gancho: 'Terminales reales en rejilla ajustable, con pestañas por grupo',
    resumen:
      'Son terminales de verdad (el mismo shell que usas fuera, con tu PATH, nvm, alias y colores), dibujadas en una rejilla que siempre llena el espacio. Cada pestaña de la app suele ser un grupo de proyectos y mantiene sus terminales vivas aunque te vayas a otra pantalla.',
    donde: 'Vista principal · barra de pestañas arriba',
    paraQue: [
      'Ver a la vez el servidor, el front y los logs sin saltar entre ventanas del sistema.',
      'Dejar procesos largos corriendo mientras usas Tareas, Versiones o el Asistente: no se matan al cambiar de pantalla.',
      'Repartir el espacio como quieras: la rejilla es un árbol de divisiones, no una cuadrícula fija.'
    ],
    pasos: [
      { titulo: '1. Crear', texto: '«Nueva terminal» (barra lateral) para una suelta, «+ Terminal» dentro de una pestaña para otra del mismo grupo (elige proyecto o terminal vacía), o el ＋ de la barra de pestañas para una pestaña nueva.' },
      { titulo: '2. Colocar', texto: 'Arrastra la barra de título de una terminal sobre otra para intercambiarlas. Arrastra los divisores para repartir el espacio: cada divisor mueve una línea completa, así nunca quedan huecos.' },
      { titulo: '3. Elegir vista', texto: '«Rejilla» muestra todas a la vez; «Pestañas» muestra una y deja el resto corriendo detrás. «Reorganizar» vuelve a la cuadrícula automática.' },
      { titulo: '4. Cambiar de vista dentro de una celda', texto: 'Una celda de un proyecto ofrece Terminal | Asistente | Archivos. Cambiar de vista no mata el proceso: la terminal solo se oculta.' }
    ],
    bloques: [
      {
        titulo: 'Qué pasa al cerrar',
        items: [
          'Cerrar una terminal mata su proceso; cerrar una pestaña con terminales pide confirmación y dice cuántos procesos se van.',
          'Recargar la ventana (Ctrl+R) cierra las terminales de esa ventana: el proceso principal mata los ptys de la ventana que se recarga.',
          'Cerrar la ventana principal cierra toda la app; cerrar una ventana separada solo mata sus terminales.'
        ]
      },
      {
        titulo: 'Historial y rendimiento',
        items: [
          'Cada terminal guarda hasta 512 KB de salida, que se repinta al adjuntarla en otra ventana o panel.',
          'La rejilla respeta un mínimo de 260×150 px por terminal al dibujar, pero guarda tus proporciones.'
        ]
      }
    ],
    atajos: [
      { tecla: 'Ctrl+R', que: 'Recarga el renderer (cierra las terminales de la ventana)' },
      { tecla: 'Clic central en una pestaña', que: 'Pedir cerrarla' },
      { tecla: 'F12', que: 'Herramientas de desarrollo (también en las ventanas del navegador)' }
    ],
    relacionadas: ['ventanas', 'terminal-ia', 'editor']
  },

  {
    id: 'ventanas',
    titulo: 'Separar y devolver pestañas',
    icono: 'ventana',
    categoria: 'Terminales',
    gancho: 'Lleva una pestaña a otra ventana (o a otro monitor) sin reiniciar nada',
    resumen:
      'Una pestaña se puede sacar a una ventana propia del sistema. No se reinician los procesos: se transfieren las terminales vivas a la ventana nueva, con su historial repintado.',
    donde: 'Botón de ventana en cada pestaña · arrastrar la pestaña fuera de la barra',
    paraQue: [
      'Poner los logs en un segundo monitor mientras editas en el principal.',
      'Aislar un grupo de proyectos en su propia ventana sin perder lo que ya estaba corriendo.'
    ],
    pasos: [
      { titulo: '1. Separar', texto: 'Pulsa el icono de ventana en la pestaña, o arrástrala hacia abajo fuera de la barra y suelta donde quieras que aparezca.' },
      { titulo: '2. Trabajar igual', texto: 'La ventana separada tiene su rejilla y sus pestañas de celda; las confirmaciones de la IA siguen llegando a un único modal.' },
      { titulo: '3. Devolver', texto: 'Desde la ventana separada, «Devolver» reasigna las terminales a la ventana principal y se cierra.' }
    ],
    bloques: [
      {
        titulo: 'Detalles',
        items: [
          'El botón de separar se desactiva hasta que todas las terminales de la pestaña tengan proceso creado.',
          'La terminal conserva su proceso al separarla; la conversación del asistente de esa celda, en cambio, se reinicia.',
          'La salida de una terminal solo viaja a la ventana que la posee, así que nada se duplica.'
        ]
      }
    ],
    relacionadas: ['terminales']
  },

  {
    id: 'terminal-ia',
    titulo: 'Terminales con IA (✦)',
    icono: 'chispa',
    categoria: 'Terminales',
    gancho: 'Lanza Claude Code (o otro CLI) dentro de una terminal, con tus agentes y tus tareas',
    resumen:
      'El botón ✦ de un proyecto abre una terminal y escribe en ella el comando del proveedor elegido. Al ser el shell interactivo quien lo ejecuta, el CLI hereda tu PATH, tu nvm y tu sesión; cuando sales del CLI, la terminal sigue viva.',
    donde: 'Botón ✦ junto a cada proyecto de la barra lateral',
    paraQue: [
      'Usar Claude Code con la configuración del proyecto sin escribir el comando a mano.',
      'Que el CLI arranque ya con los agentes y skills que tengas activados para ese proyecto o grupo.',
      'Darle acceso a tus tareas, git y GitHub de la app mediante el servidor MCP odesk.'
    ],
    pasos: [
      { titulo: '1. Elegir proveedor', texto: 'El menú ✦ lista los proveedores configurados y el «Asistente integrado». Un proveedor con «?» no se encontró en el PATH de la app.' },
      { titulo: '2. La app prepara el entorno', texto: 'Si el binario es claude y la terminal tiene proyecto, se genera un plugin con tus agentes, skills y el servidor MCP de la app, y se añade --plugin-dir. Nada se escribe en el repositorio del proyecto.' },
      { titulo: '3. Trabajar', texto: 'Es el CLI real: mismos comandos, misma sesión. La app no interfiere en la conversación.' }
    ],
    bloques: [
      {
        titulo: 'Importante',
        items: [
          'Una terminal normal, o un claude escrito a mano, no carga los agentes de la biblioteca: hace falta abrirla con ✦.',
          'El plugin se genera en ~/.odesk-agent/sesiones/<proyecto>-<hash>/ y es inmutable por contenido (mismo contenido, misma carpeta).',
          'Las herramientas de tareas, git y GitHub llegan por el servidor MCP odesk, que necesita la app abierta.'
        ]
      }
    ],
    relacionadas: ['proveedores', 'agentes-skills', 'tareas', 'asistente']
  },

  {
    id: 'asistente',
    titulo: 'Asistente',
    icono: 'chispa',
    categoria: 'Asistente de IA',
    gancho: 'Chat con herramientas, streaming, memoria y confirmaciones, dentro de tus proyectos',
    resumen:
      'El asistente propio de la app: habla directamente con la API de Anthropic (no envuelve un CLI), ejecuta herramientas sobre el proyecto (leer y escribir archivos, comandos, tareas, git, GitHub, MCP) y lo hace siempre bajo guardrails, permisos y confirmaciones.',
    donde: 'Pantalla «Asistente» (barra lateral) · pestaña Asistente de cada celda de proyecto',
    paraQue: [
      'Pedir cambios en un proyecto concreto y ver en vivo qué herramientas usa y con qué resultado.',
      'Consultar un grupo entero: un especialista de solo lectura por proyecto y un coordinador que sintetiza.',
      'Tener una conversación por proyecto que sobrevive a reinicios y queda en el historial.'
    ],
    pasos: [
      { titulo: '1. Elegir destino', texto: 'Proyecto (trabaja en su carpeta), grupo (consulta A2A entre proyectos) o ninguno (charla suelta).' },
      { titulo: '2. Elegir modo', texto: '«Chat» para trabajar paso a paso; «Flujo» para el ciclo planificar → aprobar → generar → probar → confirmar, normalmente aislado en una rama.' },
      { titulo: '3. Escribir, adjuntar y enviar', texto: 'Admite imágenes, PDF y texto (📎, Ctrl+V o arrastrar), hasta 5 por mensaje. Con adjuntos y la caja vacía, Enter los envía solos.' },
      { titulo: '4. Atender las confirmaciones', texto: 'Cuando el agente necesita permiso, un modal muestra la acción exacta (comando o archivo y contenido). Esc rechaza; lo destructivo va en rojo y siempre pregunta.' },
      { titulo: '5. Revisar lo que hizo', texto: 'Las herramientas se despliegan con su resultado; Trazas guarda el árbol de la ejecución y Versiones muestra el diff real de los cambios.' }
    ],
    bloques: [
      {
        titulo: 'Pestañas del asistente',
        items: [
          'Conversación: streaming, herramientas, decisión del router, pasos del flujo, consultas A2A, guardrails y ramas creadas.',
          'Trazas: ejecuciones y su árbol de spans con tiempos, tokens, entradas y salidas.',
          'Memoria: reglas, decisiones y hechos, por proyecto o globales.',
          'Ramas: ramas aisladas creadas por el agente; publicar o descartar.',
          'Permisos y Comandos /: reglas guardadas y comandos propios.',
          'Evals: suites contra el modelo real, con comparación de informes.'
        ]
      },
      {
        titulo: 'Modelo, contexto y consumo',
        items: [
          '«Modelo: automático» deja que el router elija según la complejidad (simple → Haiku, media → Sonnet, compleja → Opus); también puedes fijar uno.',
          'El medidor sobre la caja de texto muestra cuánto de la ventana del modelo ocupa la conversación: ámbar al 70 % (a partir de ahí se comprime sola) y rojo al 90 %.',
          'El chip «Sesión · Hoy» muestra tokens de la conversación y del día, por modelo, los últimos 7 días y los límites de tasa que informa la API.',
          'No se puede mostrar el saldo ni la facturación de la cuenta: con una clave de API normal la API no los expone.'
        ]
      },
      {
        titulo: 'Requisitos',
        items: [
          'Proveedor «suscripción» (por defecto): usa claude -p con tu sesión de Claude (claude auth login). No ofrece flujos ni grupos.',
          'Proveedor «api»: usa el núcleo propio y necesita ANTHROPIC_API_KEY (del entorno o del proveedor claude). Es el que da flujos, grupos y todas las herramientas.'
        ]
      }
    ],
    limites: ['El asistente integrado habla solo con Anthropic; elegir otros proveedores está pendiente.'],
    relacionadas: ['permisos', 'comandos', 'flujo', 'memoria', 'trazas', 'evals', 'cuentas']
  },

  {
    id: 'permisos',
    titulo: 'Permisos y modos de autonomía',
    icono: 'escudo',
    categoria: 'Asistente de IA',
    gancho: 'Decide una vez qué puede hacer sin preguntar; lo destructivo pregunta siempre',
    resumen:
      'Dos controles que se combinan: el modo de autonomía (cuánto pregunta en general) y las reglas de permisos (qué comandos o herramientas concretas se permiten o se deniegan, guardadas por proyecto o globales).',
    donde: 'Desplegable de autonomía en la cabecera del chat · pestaña «Permisos» del Asistente · modal de confirmación',
    paraQue: [
      'Dejar de confirmar lo rutinario (pnpm test, git commit …) sin abrir la puerta a todo.',
      'Prohibir de raíz algo que no quieres que haga nunca: lo denegado ni se pregunta.',
      'Subir la autonomía solo cuando el trabajo está aislado en una rama.'
    ],
    pasos: [
      { titulo: '1. Elige el modo', texto: 'Preguntar todo (por defecto), Aceptar ediciones o Autónomo. Se recuerda por proyecto; activar Autónomo pide confirmación.' },
      { titulo: '2. Guarda reglas desde el propio modal', texto: 'En una confirmación no destructiva, «Permitir siempre en este proyecto» guarda la regla exacta que acabas de ver.' },
      { titulo: '3. Afínalas en la pestaña Permisos', texto: 'Tipo comando (línea de comando) o herramienta (admite * al final, p. ej. mcp__db__*), acción permitir o denegar, y patrón exacto o con * al final.' }
    ],
    bloques: [
      {
        titulo: 'Qué cambia cada modo',
        items: [
          'Preguntar todo: confirma las escrituras de archivos y los comandos (salvo los que tengan regla permitir). El plan del flujo lo apruebas tú.',
          'Aceptar ediciones: las escrituras dentro del proyecto pasan solas (tras los guardrails); los comandos siguen confirmándose.',
          'Autónomo: escrituras solas y, de comandos, solo typecheck, lint y test del proyecto; el plan del flujo se aprueba solo y hay un presupuesto de 300 000 tokens por ejecución.'
        ]
      },
      {
        titulo: 'Reglas de seguridad (valen en los tres modos)',
        items: [
          'Denegar gana siempre y se evalúa antes que todo lo demás.',
          'Lo destructivo nunca se puede permitir por regla (rm, git push, reset --hard, clean, sudo, curl, publicar…): siempre pide confirmación, y no se ofrece «Permitir siempre».',
          'Los intérpretes con comodín (node *, bash *, python *, npx *, docker *…) no se admiten como regla: equivaldrían a permitir todo. El comando exacto sí (node scripts/seed.js).',
          'Los guardrails siguen activos por encima de cualquier regla: no se leen .env ni claves, no se escriben credenciales, no se toca .git.',
          'Las herramientas MCP y las escrituras en memoria se confirman siempre.'
        ]
      }
    ],
    limites: [
      'Las reglas son por programa y argumentos exactos: no entienden pipes ni redirecciones (no hay shell).',
      'En «Autónomo» solo cuentan como verificaciones los scripts typecheck/type-check/check-types/tsc, lint y test del package.json.'
    ],
    relacionadas: ['asistente', 'comandos', 'flujo', 'seguridad']
  },

  {
    id: 'comandos',
    titulo: 'Comandos con /',
    icono: 'rayo',
    categoria: 'Asistente de IA',
    gancho: 'Atajos escritos en el chat: plantillas de prompt o programas fijos',
    resumen:
      'En la caja del chat, al teclear / aparece el autocompletado. Hay comandos incluidos y comandos propios que puedes crear por proyecto o globales: plantillas de prompt o programas concretos cuya salida entra en la conversación.',
    donde: 'Caja del chat (teclea /) · pestaña «Comandos /» del Asistente',
    paraQue: [
      'Repetir peticiones habituales sin reescribirlas («revisa el diff y propón el mensaje»).',
      'Meter en la conversación la salida de un script tuyo (tests, lint, seeds) sin copiar y pegar.',
      'Cambiar de modo o abrir pantallas sin soltar el teclado.'
    ],
    pasos: [
      { titulo: '1. Usa los incluidos', texto: '/flujo <petición>, /chat, /modo preguntar|ediciones|autonomo, /nueva, /historial, /permisos, /comandos, /ayuda. Además /commit, /pr, /plan y /tareas.' },
      { titulo: '2. Crea los tuyos', texto: 'En la pestaña «Comandos /»: tipo prompt (plantilla, con $ARGUMENTOS donde quieras lo que se escriba detrás) o ejecutable (programa fijo, sin shell).' },
      { titulo: '3. Ejecútalos', texto: '↑↓ y Tab o Enter para completar, Esc para cerrar el autocompletado. Un comando del proyecto manda sobre el global con el mismo nombre.' }
    ],
    bloques: [
      {
        titulo: 'Cómo se ejecuta un comando propio',
        items: [
          'Primero los guardrails y las reglas de denegación: cat .env o un comando denegado ni se pregunta.',
          'Lo destructivo siempre pregunta, incluso si el comando está marcado como permitido.',
          'Un comando permitido (o con regla permitir) se ejecuta sin preguntar; el resto pide confirmación.',
          'Los ejecutables no pasan por el modelo: su salida aparece en el chat y se adjunta al siguiente mensaje para que el agente la vea.',
          'Timeout de 10 minutos, salida recortada a 20 000 caracteres y se puede cancelar.'
        ]
      }
    ],
    relacionadas: ['asistente', 'permisos', 'tareas', 'versiones']
  },

  {
    id: 'flujo',
    titulo: 'Flujo de desarrollo y ramas aisladas',
    icono: 'rama',
    categoria: 'Asistente de IA',
    gancho: 'Planificar, aprobar, generar, probar y confirmar — fuera de tu árbol de trabajo',
    resumen:
      'El modo «Flujo» convierte una petición en un ciclo con puertas humanas y lo ejecuta en un git worktree propio, con su rama agente/<resumen>, así que tu copia de trabajo no se toca mientras el agente escribe.',
    donde: 'Modo «Flujo» en el Asistente, o /flujo <petición> · pestaña «Ramas»',
    paraQue: [
      'Encargar un cambio completo sabiendo exactamente qué se aprobó antes de que se escriba una línea.',
      'Dejar que el agente itere contra typecheck, lint y test sin ensuciar tu rama.',
      'Revisar el resultado como un cambio de git normal y fusionarlo tú.'
    ],
    pasos: [
      { titulo: '1. Planificación', texto: 'Un agente de solo lectura propone el plan. Se muestran también las verificaciones que se ejecutarán.' },
      { titulo: '2. Aprobación', texto: 'Apruebas o rechazas con un comentario (vuelve a planificar; máximo 3 planes). Aprobar el plan autoriza únicamente escribir archivos del generador.' },
      { titulo: '3. Generación y pruebas', texto: 'El generador escribe en el worktree; se ejecutan typecheck, lint y test del package.json en orden, parando en el primero que falle. La salida del fallo vuelve al generador (máximo 3 intentos).' },
      { titulo: '4. Confirmación', texto: 'Revisas el resultado: aceptar confirma los cambios en la rama del worktree; rechazar con comentario vuelve a generación. La confirmación final siempre es tuya, en cualquier modo.' },
      { titulo: '5. Integrar', texto: 'En «Ramas» puedes publicar la rama (push, con confirmación destructiva) o descartarla. Fusionar es cosa tuya, en la pantalla Versiones.' }
    ],
    bloques: [
      {
        titulo: 'Qué pasa con el worktree al terminar',
        items: [
          'Completado: se revisa todo el diff (incluidos archivos nuevos) buscando credenciales. Limpio → commit en la rama del worktree.',
          'Con credenciales detectadas: no se confirma, el flujo queda como fallido y el worktree se conserva.',
          'Fallido: se conserva para que puedas inspeccionarlo.',
          'Rechazado o cancelado: se descartan worktree y rama.'
        ]
      },
      {
        titulo: 'Requisitos y variantes',
        items: [
          'Flujos y grupos requieren el proveedor «api» (clave de ANTHROPIC_API_KEY); en suscripción no están disponibles.',
          'El proyecto debe ser un repositorio git con al menos un commit; si no, el flujo avisa con un mensaje claro.',
          'Se puede desactivar el aislamiento para trabajar en la carpeta del proyecto, con las mismas confirmaciones.',
          'node_modules del repositorio se enlaza en el worktree para poder ejecutar las verificaciones (y se excluye al confirmar).'
        ]
      }
    ],
    limites: ['La rama no se integra ni se sube sola: la revisas y la fusionas tú.'],
    relacionadas: ['asistente', 'permisos', 'versiones', 'trazas']
  },

  {
    id: 'memoria',
    titulo: 'Memoria del agente',
    icono: 'cerebro',
    categoria: 'Asistente de IA',
    gancho: 'Reglas, decisiones y hechos que el agente recuerda entre conversaciones',
    resumen:
      'Dos niveles: la memoria corta es la conversación (que se poda y se resume sola cuando el contexto se llena) y la memoria larga son notas guardadas por proyecto o globales que el agente consulta en cada ejecución.',
    donde: 'Pestaña «Memoria» del Asistente',
    paraQue: [
      'No repetir en cada conversación las convenciones del proyecto.',
      'Dejar constancia de decisiones técnicas y de por qué se tomaron.',
      'Que el agente arranque con el contexto correcto en lugar de deducirlo.'
    ],
    pasos: [
      { titulo: '1. Mira lo que hay', texto: 'La pestaña Memoria lista las notas del proyecto y las globales.' },
      { titulo: '2. Añade o deja que las proponga', texto: 'Puedes escribirlas tú; cuando el agente quiere guardar algo, pide confirmación (las escrituras en memoria se confirman siempre).' },
      { titulo: '3. Mantenla pequeña', texto: 'Borra lo que ya no es cierto: una nota equivocada se propaga a todas las conversaciones.' }
    ],
    bloques: [
      {
        titulo: 'Detalles',
        items: [
          'La memoria rechaza credenciales: no se guardan claves ni tokens.',
          'La conversación se guarda al terminar cada respuesta en ~/.odesk-agent/conversaciones/ (sin los trozos de streaming y con las credenciales redactadas).',
          'Cada proyecto recuerda su conversación activa entre reinicios; se conservan las 50 más recientes por proyecto.'
        ]
      }
    ],
    relacionadas: ['asistente', 'trazas', 'datos']
  },

  {
    id: 'trazas',
    titulo: 'Trazas',
    icono: 'actividad',
    categoria: 'Asistente de IA',
    gancho: 'El árbol completo de cada ejecución: agentes, llamadas al modelo y herramientas',
    resumen:
      'Cada ejecución del asistente se graba como un árbol de spans (agente, llamada al modelo, herramienta, evento) con tiempos, tokens, entradas y salidas, para poder revisar después qué pasó y por qué.',
    donde: 'Pestaña «Trazas» del Asistente',
    paraQue: [
      'Entender por qué el agente hizo algo: qué leyó antes, qué devolvió la herramienta.',
      'Ver dónde se fueron los tokens y el tiempo.',
      'Depurar subagentes, flujos y consultas entre proyectos, que son difíciles de seguir en el chat.'
    ],
    pasos: [
      { titulo: '1. Elige la ejecución', texto: 'La lista muestra las ejecuciones; al elegir una se dibuja su cascada de spans.' },
      { titulo: '2. Despliega', texto: 'Cada span muestra su duración, tokens y la entrada y salida reales.' },
      { titulo: '3. Limpia', texto: 'Las trazas se pueden eliminar cuando ya no hacen falta.' }
    ],
    bloques: [{ titulo: 'Detalles', items: ['Las credenciales se redactan al guardarlas.', 'Se guardan en ~/.odesk-agent/trazas/.'] }],
    relacionadas: ['asistente', 'evals', 'flujo']
  },

  {
    id: 'evals',
    titulo: 'Evals',
    icono: 'evals',
    categoria: 'Asistente de IA',
    gancho: 'Suites que miden si el agente sigue haciendo bien su trabajo',
    resumen:
      'Ejecuta un conjunto de casos contra el modelo real y los evalúa con aserciones y con un modelo juez. Guarda un informe y lo compara con el anterior para señalar regresiones.',
    donde: 'Pestaña «Evals» del Asistente · pnpm evals desde la terminal',
    paraQue: [
      'Comprobar que un cambio en prompts, herramientas o permisos no empeora el comportamiento.',
      'Tener una referencia objetiva antes y después de tocar el núcleo del agente.'
    ],
    pasos: [
      { titulo: '1. Lanza la suite', texto: 'Pide confirmación porque consume tokens de verdad: habla con el modelo real.' },
      { titulo: '2. Lee el informe', texto: 'Resultado por caso y comparación con el informe anterior (qué mejoró y qué se rompió).' },
      { titulo: '3. Revisa el historial', texto: 'Los informes anteriores quedan guardados para ver la evolución.' }
    ],
    bloques: [
      {
        titulo: 'Detalles',
        items: [
          'Desde la terminal: pnpm evals (necesita ANTHROPIC_API_KEY; sin clave se omite).',
          'El consumo de los evals cuenta en el medidor de uso de la app.',
          'El presupuesto de tokens del modo autónomo no cuenta el modelo juez.'
        ]
      }
    ],
    relacionadas: ['asistente', 'trazas']
  },

  {
    id: 'proveedores',
    titulo: 'Proveedores de IA',
    icono: 'chispa',
    categoria: 'Asistente de IA',
    gancho: 'Qué CLI abre el botón ✦ y con qué entorno',
    resumen:
      'Un proveedor es un CLI de IA que la app puede lanzar dentro de una terminal: su nombre, su comando y las variables de entorno que necesita. La app comprueba si el binario está en su PATH.',
    donde: 'Pantalla «Proveedores de IA» (barra lateral)',
    paraQue: [
      'Tener Claude Code (y los CLIs que uses) a un clic desde cualquier proyecto.',
      'Guardar la clave que necesita un CLI sin exportarla en tu shell.'
    ],
    pasos: [
      { titulo: '1. Revisa los que hay', texto: 'La lista indica si el binario se encuentra en el PATH de la app; si no, aparece marcado con «?».' },
      { titulo: '2. Añade o edita', texto: 'Nombre visible, comando y variables de entorno. El renderer solo manda el id del proveedor: el comando se resuelve en el proceso principal.' },
      { titulo: '3. Úsalo', texto: 'Aparece en el menú ✦ de cada proyecto y en el menú de terminales nuevas.' }
    ],
    bloques: [
      {
        titulo: 'Seguridad',
        items: [
          'Los proveedores se guardan en ~/.odesk-agent/proveedores.json con permisos 0600.',
          'Las variables de entorno de un proveedor se guardan en texto plano en tu equipo: evita poner ahí claves que no quieras en disco.',
          'La clave del proveedor claude también sirve al asistente integrado en modo «api» si no hay ANTHROPIC_API_KEY en el entorno.'
        ]
      }
    ],
    relacionadas: ['terminal-ia', 'cuentas', 'asistente']
  },

  {
    id: 'cuentas',
    titulo: 'Varias cuentas de suscripción',
    icono: 'reloj',
    categoria: 'Asistente de IA',
    gancho: 'Cambia de cuenta de Claude al topar con el límite, sin perder la conversación',
    resumen:
      'En modo suscripción la app puede manejar varias cuentas de Claude: la principal es tu ~/.claude de siempre y las demás guardan su propio login aparte. Con «cambiar sola», al topar con un límite de uso se reintenta con otra cuenta que tenga sesión.',
    donde: 'Barra de cuenta en la cabecera del Asistente',
    paraQue: [
      'Seguir trabajando cuando una cuenta agota su límite de uso.',
      'Separar trabajo de pruebas en cuentas distintas.'
    ],
    pasos: [
      { titulo: '1. Añade una cuenta', texto: 'La app crea su propia carpeta de configuración y pide iniciar sesión en ella (claude auth login).' },
      { titulo: '2. Elige la activa', texto: 'La cuenta activa se elige a mano; la barra muestra cuál está en uso.' },
      { titulo: '3. Activa «cambiar sola»', texto: 'Si una ejecución es rechazada por límite de uso y aún no había ejecutado herramientas, se reintenta con otra cuenta con sesión (así no se duplican cambios).' }
    ],
    bloques: [
      {
        titulo: 'Detalles',
        items: [
          'La conversación se lleva copiando el archivo de sesión de la cuenta anterior: no se reenvía el historial al modelo.',
          'No se guarda el id de sesión de una ejecución rechazada.',
          'El modo suscripción no ofrece flujos ni grupos; para eso hace falta el proveedor «api».'
        ]
      }
    ],
    relacionadas: ['proveedores', 'asistente']
  },

  {
    id: 'agentes-skills',
    titulo: 'Agentes y skills',
    icono: 'agente',
    categoria: 'Asistente de IA',
    gancho: 'Biblioteca de subagentes y skills de Claude Code, activables por grupo o proyecto',
    resumen:
      'Una biblioteca de recursos (agentes y skills de Claude Code) que puede ser compartida o propia de un proyecto. Al abrir una terminal ✦ con Claude en un proyecto, la app empaqueta los recursos activos como plugin y se los pasa al CLI.',
    donde: 'Pantalla «Agentes y skills» (barra lateral)',
    paraQue: [
      'Reutilizar los mismos subagentes y skills en todos los proyectos de un grupo.',
      'Dar a cada proyecto los suyos sin tocar su repositorio.',
      'Evitar copiar y pegar carpetas .claude entre repos.'
    ],
    pasos: [
      { titulo: '1. Crea el recurso', texto: 'En la biblioteca: un agente o una skill, compartido o ligado a un proyecto.' },
      { titulo: '2. Actívalo', texto: 'Por grupo (lo heredan sus proyectos) o por proyecto concreto.' },
      { titulo: '3. Ábrelo con ✦', texto: 'Solo las terminales abiertas con un proveedor cuyo binario sea claude y con proyecto cargan el plugin generado.' }
    ],
    bloques: [
      {
        titulo: 'Detalles',
        items: [
          'El plugin se genera en ~/.odesk-agent/sesiones/<proyecto>-<hash>/ y lleva también el .mcp.json del servidor odesk (tareas, git y GitHub).',
          'Nada se escribe en el repositorio del proyecto.',
          'Una terminal normal o un claude escrito a mano no cargan la biblioteca.'
        ]
      }
    ],
    relacionadas: ['terminal-ia', 'proveedores', 'proyectos']
  },

  {
    id: 'tareas',
    titulo: 'Tareas',
    icono: 'tareas',
    categoria: 'Herramientas',
    gancho: 'Tablero compartido con la IA, con reglas que valen para los dos',
    resumen:
      'Gestión de tareas por grupos y proyectos que tú y la IA compartís con las mismas reglas: la IA consulta y cambia las tareas con las mismas validaciones que la interfaz, y cada cambio queda en la actividad indicando quién lo hizo.',
    donde: 'Pantalla «Tareas» (barra lateral)',
    paraQue: [
      'Partir una funcionalidad en pasos con criterios de aceptación antes de implementar.',
      'Que el agente sepa en qué está trabajando y lo marque al avanzar.',
      'Ver qué está bloqueado, qué vence y qué conviene hacer a continuación.'
    ],
    pasos: [
      { titulo: '1. Elige el ámbito', texto: 'Todas, sin proyecto, un grupo o un proyecto. Una tarea puede nacer suelta y vincularse después sin perder nada.' },
      { titulo: '2. Crea tareas', texto: 'Entrada rápida para el título y, en el panel de detalle, descripción, prioridad, vencimiento, etiquetas, criterios, subtareas, dependencias («espera a #N»), referencias y comentarios. Cada tarea se nombra por su número (#12).' },
      { titulo: '3. Trabaja en el tablero', texto: 'Arrastra entre columnas; o usa Lista (búsqueda y filtros), Resumen (progreso, bloqueadas, vencidas, sin criterios, siguiente recomendada) y Actividad (quién hizo qué, usuario o ✦ IA).' },
      { titulo: '4. Deja que la IA participe', texto: 'Con /plan <funcionalidad> las descompone con criterios y dependencias sin implementar; con /tareas revisa bloqueos y propone el siguiente paso.' }
    ],
    bloques: [
      {
        titulo: 'Reglas (iguales para ti y para la IA)',
        items: [
          'Terminar exige todos los criterios y subtareas cumplidos y las dependencias terminadas (las descartadas no bloquean).',
          'Bloquear, descartar y reabrir exigen un motivo, que queda en el historial con el autor y la fecha.',
          'Las dependencias no admiten ciclos; una tarea nueva no puede nacer terminada, bloqueada ni descartada.',
          'Los estados son editables (ocho por defecto) y lo que manda es su categoría: sin empezar, en curso, bloqueada, terminada o descartada. Quitar un estado con tareas obliga a decir a qué estado pasan.'
        ]
      },
      {
        titulo: 'Cómo las ve la IA',
        items: [
          'Al lanzar el asistente en un proyecto, el prompt incluye un resumen de sus tareas abiertas y las reglas de trabajo.',
          'Las herramientas llegan por el registro del núcleo (modo API) y por el servidor MCP odesk (suscripción y terminales ✦); el MCP necesita la app abierta.',
          'La IA no puede borrar tareas: puede descartarlas con un motivo. Eliminar es solo tuyo.'
        ]
      }
    ],
    limites: ['Sin usuarios ni responsables, permisos por usuario, Gantt, plantillas, tareas recurrentes ni estimaciones: la app es de un solo usuario.'],
    relacionadas: ['asistente', 'comandos', 'versiones']
  },

  {
    id: 'versiones',
    titulo: 'Control de versiones (git)',
    icono: 'rama',
    categoria: 'Herramientas',
    gancho: 'Cambios, historial, ramas, etiquetas, stash y sincronización, sin salir de la app',
    resumen:
      'La pantalla Versiones maneja git por proyecto: ves y preparas cambios, confirmas, navegas el historial, gestionas ramas y etiquetas, apartas trabajo en stash y sincronizas con el remoto. El renderer nunca manda rutas de repositorio: manda el id del proyecto.',
    donde: 'Pantalla «Versiones» (barra lateral)',
    paraQue: [
      'Revisar el diff real de lo que acabas de cambiar (o de lo que cambió el agente) antes de confirmar.',
      'Llevar ramas y versiones del proyecto sin memorizar comandos.',
      'Resolver lo normal del día (pull, push, merge, stash) con los conflictos señalados.'
    ],
    pasos: [
      { titulo: '1. Cambios', texto: 'Archivos en conflicto, preparados, modificados y nuevos; prepara o quita (uno o todos), descarta con confirmación, mira el diff con números de línea y confirma con un mensaje (Ctrl+Enter). «Enmendar último» cambia el último commit.' },
      { titulo: '2. Historial', texto: 'Commits con sus ramas y etiquetas, paginado y filtrable por rama y texto. El detalle muestra autor, fecha, hash, padres y los archivos con sus diferencias; desde ahí puedes crear una rama o una versión en ese commit, o revertirlo (commit inverso, sin reescribir historia).' },
      { titulo: '3. Ramas y versiones', texto: 'Crear, cambiar, fusionar en la actual y eliminar (si tiene commits sin fusionar, pide confirmar). Las versiones son etiquetas anotadas: la app sugiere la siguiente (parche, menor, mayor) y dice cuántos commits hay desde la última.' },
      { titulo: '4. Stash y sincronizar', texto: 'Aparta cambios sin confirmar (con o sin archivos nuevos) y recupéralos. Obtener (fetch), Traer (pull sin mezclar; con rebase si divergió) y Enviar/Publicar rama. Los conflictos se resuelven en «Cambios» y se confirman, o se aborta la operación.' },
      { titulo: '5. Primeros pasos', texto: 'Si el proyecto no es un repositorio, se puede inicializar; y si falta, configurar tu nombre y correo (global o del proyecto).' }
    ],
    bloques: [
      {
        titulo: 'Seguridad',
        items: [
          'git se ejecuta sin shell; las rutas van siempre tras -- y con pathspecs literales (sin comodines ni «magia»), validadas (sin .., rutas absolutas ni guiones iniciales).',
          'No hay push forzado ni reset duro, y las URL de los remotos se muestran sin credenciales.',
          'Las escrituras de un mismo repositorio van en cola (evita index.lock); las lecturas no tocan los locks.',
          'Los errores de autenticación se explican: la app no puede pedir contraseñas (usa clave SSH con ssh-agent o un credential helper).'
        ]
      },
      {
        titulo: 'Qué puede hacer la IA aquí',
        items: [
          'Consultar siempre: estado, diff, historial y ramas.',
          'Cambiar desde «Aceptar ediciones»: preparar, confirmar, crear y cambiar de rama.',
          'Salir de la máquina (enviar, traer, crear PR o issue): solo en autónomo con suscripción; en modo API siempre pide confirmación explícita, que nunca se recuerda.',
          'Nunca: descartar cambios, borrar ramas, reset, push forzado ni fusionar pull requests. Eso es tuyo.',
          'Se niega a preparar o confirmar archivos que parecen secretos (.env, claves, credenciales).'
        ]
      }
    ],
    limites: ['Fuera de alcance a propósito: reescribir historia (reset, rebase interactivo, push forzado), resolver conflictos línea a línea en la interfaz, submódulos y firmar commits.'],
    relacionadas: ['github', 'flujo', 'editor', 'asistente']
  },

  {
    id: 'github',
    titulo: 'GitHub',
    icono: 'rama',
    categoria: 'Herramientas',
    gancho: 'Clonar, publicar, pull requests e incidencias con un token, sin instalar el CLI gh',
    resumen:
      'Pestaña GitHub de la pantalla Versiones: habla con la API REST usando un token personal que se guarda cifrado con el llavero del sistema. No hace falta instalar gh.',
    donde: 'Pantalla «Versiones» → pestaña «GitHub» · botón «Clonar» (siempre visible)',
    paraQue: [
      'Subir un proyecto local a GitHub creando el repositorio desde la app.',
      'Abrir y revisar pull requests, con el estado de sus comprobaciones de CI.',
      'Clonar un repositorio y tenerlo ya agregado como proyecto.'
    ],
    pasos: [
      { titulo: '1. Conectar', texto: 'Un botón abre GitHub en la página de crear un token con los permisos ya marcados (repo, workflow); lo pegas y la app lo valida.' },
      { titulo: '2. Clonar', texto: 'De tu lista de repositorios, por propietario/repo o por URL (https, ssh o ruta local). Eliges carpeta y grupo; se clona, se agrega como proyecto y se abre.' },
      { titulo: '3. Publicar', texto: 'Si el proyecto no tiene remoto, «Crear y publicar» crea el repositorio (privado por defecto, en tu cuenta o en una organización), lo enlaza como origin y envía la rama actual. Valida antes de crear nada.' },
      { titulo: '4. Pull requests e incidencias', texto: 'El PR de la rama actual con su CI, crear uno (envía la rama si hace falta), fusionar (squash, merge o rebase, con confirmación), listar los abiertos y «Traer rama» para revisarlos en local. Las incidencias se listan y se crean.' }
    ],
    bloques: [
      {
        titulo: 'Detalles',
        items: [
          'El token se guarda cifrado con el llavero del sistema, nunca en claro; sin llavero seguro (Linux sin gestor de claves) solo vive en memoria hasta cerrar la app, y la pantalla lo avisa.',
          'El repositorio se deduce del remoto del proyecto, resolviendo alias de ~/.ssh/config.',
          'Enviar y traer por https funcionan sin configurar nada: las credenciales se pasan a git solo para el servidor de GitHub por https.',
          'Comandos del asistente: /commit (propone el mensaje tras revisar el diff) y /pr (redacta título y descripción y espera tu visto bueno).'
        ]
      }
    ],
    relacionadas: ['versiones', 'comandos', 'seguridad']
  },

  {
    id: 'api',
    titulo: 'Cliente API',
    icono: 'api',
    categoria: 'Herramientas',
    gancho: 'Peticiones HTTP con entornos, colecciones, historial y respuesta en árbol',
    resumen:
      'Un cliente HTTP integrado al estilo Postman. Las peticiones se ejecutan en el proceso principal, así que no hay CORS y se puede llamar a localhost sin trucos.',
    donde: 'Pantalla «Cliente API» (barra lateral)',
    paraQue: [
      'Probar el backend que estás levantando en la terminal de al lado.',
      'Guardar las peticiones del proyecto en colecciones y cambiar de entorno (local, staging) sin reescribir URLs.',
      'Inspeccionar respuestas JSON grandes sin pelearse con el formato.'
    ],
    pasos: [
      { titulo: '1. Arma la petición', texto: 'Método, URL, parámetros, cabeceras (con sugerencias), cuerpo (JSON con validación y «Formatear», texto o formulario) y autenticación (Bearer, Basic, clave de API).' },
      { titulo: '2. Envía', texto: 'Enter o Ctrl+Enter; se puede cancelar. Varias peticiones a la vez en pestañas. Opciones: seguir redirecciones, ignorar errores de certificado (https autofirmado local) y tiempo máximo.' },
      { titulo: '3. Lee la respuesta', texto: 'Estado coloreado, tiempo, tamaño y redirecciones; cuerpo como árbol JSON (se pliega, copia el valor o la ruta $.datos[0].id, pagina listas largas), formateado o crudo; imágenes en pantalla; cabeceras y detalles. Copiar el cuerpo o guardarlo en un archivo.' },
      { titulo: '4. Reutiliza', texto: 'Variables por entorno ({{baseUrl}}, {{token}}) usables en URL, cabeceras, cuerpo y autenticación; colecciones para guardar peticiones y un historial de las últimas 100. Copiar como cURL e importar un cURL pegado.' }
    ],
    bloques: [
      {
        titulo: 'Detalles',
        items: [
          'El historial guarda la petición con sus {{variables}}, nunca con los secretos ya sustituidos.',
          'Redirecciones propias (303 pasa a GET; las credenciales no viajan a otro servidor), descompresión gzip/deflate/brotli y límite de 20 MB (avisa si corta).',
          'Los errores de red se explican: conexión rechazada, DNS, certificado…',
          'Los tokens de los entornos se guardan sin cifrar en ~/.odesk-agent/api/datos.json (permisos 0600).'
        ]
      }
    ],
    limites: ['Fuera de alcance: multipart y subida de archivos, cookies compartidas entre peticiones, WebSocket/GraphQL con editor propio, scripts por petición, importar colecciones de Postman y proxy.'],
    relacionadas: ['navegador', 'terminales']
  },

  {
    id: 'navegador',
    titulo: 'Navegador integrado',
    icono: 'globo',
    categoria: 'Herramientas',
    gancho: 'Abre tus servidores locales en una ventana aislada, detectados solos',
    resumen:
      'Detecta los servidores que están escuchando en los puertos habituales y los abre en una ventana propia con barra de direcciones. La página va en una vista web aislada, sin acceso a la app.',
    donde: 'Pantalla «Navegador» (barra lateral)',
    paraQue: [
      'Ver lo que estás desarrollando sin cambiar de aplicación.',
      'Encontrar en qué puerto quedó el servidor que levantaste hace media hora.',
      'Tener la app y la página lado a lado en monitores distintos.'
    ],
    pasos: [
      { titulo: '1. Abre una dirección', texto: 'Escribe localhost:3000, 5173 o ejemplo.com y se abre una ventana con barra de direcciones: atrás, adelante, recargar/detener, herramientas de desarrollo (F12) y abrir en el navegador del sistema. Hasta 8 ventanas.' },
      { titulo: '2. O elige un servidor detectado', texto: 'Se listan los que escuchan en los puertos habituales (3000, 4200, 5173, 8000, 8080…) con el título de su página; se actualiza solo. Hay favoritos y recientes.' },
      { titulo: '3. O ábrelo fuera', texto: 'El mismo botón permite abrir la dirección en tu navegador de siempre.' }
    ],
    bloques: [
      {
        titulo: 'Seguridad',
        items: [
          'La página corre en sandbox, sin preload: no ve window.api, require ni process, y tiene su propia sesión.',
          'Solo http y https (se rechazan file:, javascript:, data:…), también en redirecciones.',
          'Se deniegan todos los permisos (cámara, ubicación, notificaciones…) salvo copiar y pantalla completa.',
          'Los certificados autofirmados solo se aceptan en localhost y red local.'
        ]
      }
    ],
    relacionadas: ['api', 'terminales']
  },

  {
    id: 'editor',
    titulo: 'Editor de archivos',
    icono: 'archivo',
    categoria: 'Herramientas',
    gancho: 'Mini editor con árbol del proyecto, marcas de git y guardado automático',
    resumen:
      'Cada celda de un proyecto tiene una pestaña «Archivos»: el árbol del proyecto y un editor con resaltado, búsqueda y pestañas. Todo el acceso pasa por el proceso principal y queda confinado a la carpeta del proyecto.',
    donde: 'Celda de un proyecto → pestaña «Archivos»',
    paraQue: [
      'Tocar un archivo rápido sin cambiar de aplicación.',
      'Ver qué archivos cambió el agente, marcados como en git, y abrirlos al momento.',
      'Editar .env y claves (son tuyos; el agente tiene prohibido leerlos).'
    ],
    pasos: [
      { titulo: '1. Navega', texto: 'El árbol carga las carpetas al desplegarlas, sin .git ni node_modules, con insignia por tipo y marcas de git (M, A, D, R, U, C; las carpetas con cambios llevan un punto).' },
      { titulo: '2. Edita', texto: 'Resaltado para TypeScript/JavaScript (con JSX), JSON, CSS, HTML, Markdown y Python; números de línea, buscar y reemplazar (Ctrl+F), plegado y varias pestañas (clic central o ✕ para cerrar).' },
      { titulo: '3. Guarda', texto: 'Guardado automático un segundo después de dejar de escribir (Ctrl+S guarda al instante); la pestaña muestra ● mientras hay cambios sin guardar. Se puede desactivar: un servidor con recarga en caliente se reinicia con cada guardado.' },
      { titulo: '4. Si cambia en disco', texto: 'Si el archivo abierto no tiene cambios tuyos, se actualiza solo; si los tiene, puedes cargar el del disco o conservar los tuyos. Nunca se pisa en silencio.' }
    ],
    bloques: [
      {
        titulo: 'Límites y seguridad',
        items: [
          'No se abren binarios, archivos de más de 1 MB ni archivos que no estén en UTF-8 (se explica el motivo).',
          'No se escribe en .git ni en node_modules.',
          'Se rechazan .., rutas absolutas y enlaces simbólicos que escapen del proyecto; los guardados son atómicos y conservan los permisos.',
          'Clic derecho: nuevo archivo, nueva carpeta, renombrar, copiar ruta relativa y mover a la papelera (recuperable).',
          'En celdas estrechas (< 560 px) el árbol pasa a un cajón que se abre con ☰.'
        ]
      }
    ],
    atajos: [
      { tecla: 'Ctrl+S', que: 'Guardar al instante' },
      { tecla: 'Ctrl+F', que: 'Buscar y reemplazar en el archivo' },
      { tecla: 'Clic central', que: 'Cerrar la pestaña del archivo' }
    ],
    relacionadas: ['terminales', 'versiones', 'asistente']
  },

  {
    id: 'datos',
    titulo: 'Dónde se guardan tus datos',
    icono: 'carpeta',
    categoria: 'Referencia',
    gancho: 'Qué hay en ~/.odesk-agent/ y qué hay en el servidor',
    resumen:
      'Lo compartido (proyectos, grupos, biblioteca de agentes) vive en el servidor. Todo lo demás se queda en tu equipo, en ~/.odesk-agent/, con permisos restringidos en los archivos sensibles.',
    paraQue: [
      'Saber qué respaldar y qué se puede borrar sin perder nada importante.',
      'Saber qué sale de tu equipo y qué no.'
    ],
    pasos: [
      { titulo: 'Si vienes de una versión anterior', texto: 'La carpeta antigua ~/.centro-proyectos/ se mueve sola al arrancar; después se reparan los worktrees de agentes, que guardan rutas absolutas.' },
      { titulo: 'Legado', texto: 'proyectos.json y agentes.json ya no se escriben: quedaron como legado tras pasar al servidor.' }
    ],
    bloques: [
      {
        titulo: 'Contenido de ~/.odesk-agent/',
        items: [
          'sesion.json: token del servidor, cifrado con el llavero del sistema.',
          'proveedores.json (0600): proveedores de IA; sus variables de entorno van en texto plano.',
          'sesiones/: plugins generados para las terminales ✦.',
          'tareas/tareas.json: tareas, con su actividad.',
          'conversaciones/ y memoria/: historial del asistente y memoria larga.',
          'permisos/ y comandos/ (0600): reglas de permisos y comandos propios.',
          'trazas/: árboles de ejecución; adjuntos/ (0600): archivos enviados al chat (se borran a los 30 días).',
          'uso/: consumo de tokens de los últimos 35 días.',
          'worktrees/: ramas aisladas de los flujos.',
          'api/datos.json (0600): colecciones, entornos e historial del cliente API (los tokens, sin cifrar).',
          'cuentas.json y cuentas/: cuentas de suscripción adicionales.',
          'tareas.sock y tareas.token (0600): canal local del servidor MCP de tareas.'
        ]
      }
    ],
    relacionadas: ['cuenta', 'seguridad']
  },

  {
    id: 'seguridad',
    titulo: 'Seguridad: qué nunca hace la app',
    icono: 'escudo',
    categoria: 'Referencia',
    gancho: 'Guardrails, secretos, confirmaciones y límites deliberados',
    resumen:
      'Las barreras no son configurables porque son el motivo por el que se puede dar trabajo a un agente con tranquilidad. Se evalúan antes que cualquier permiso o autonomía.',
    paraQue: [
      'Saber qué no va a pasar aunque subas la autonomía.',
      'Entender por qué una acción se bloquea y no se te ofrece ni como pregunta.'
    ],
    pasos: [
      { titulo: 'Orden en que se decide una acción', texto: 'Guardrails → reglas de denegación → ¿es destructiva? (siempre pregunta) → reglas de permiso y modo de autonomía → confirmación.' }
    ],
    bloques: [
      {
        titulo: 'Guardrails del agente',
        items: [
          'No lee .env, claves ni .npmrc (su contenido iría a la API del modelo); las plantillas .env.example sí.',
          'Al escribir: bloquea rutas sensibles, credenciales en el contenido y JSON inválido.',
          'Al ejecutar: bloquea comandos cuyos argumentos apunten a archivos sensibles (cat .env).',
          'La memoria y las herramientas MCP no reciben credenciales.',
          'Al confirmar un flujo se escanea todo el diff buscando credenciales; si aparecen, no se confirma.',
          'Nunca se devuelve el secreto completo: se muestra un extracto redactado.'
        ]
      },
      {
        titulo: 'Límites de la aplicación',
        items: [
          'El renderer no toca el sistema: contextIsolation, sandbox y CSP activos; solo ve window.api.',
          'El renderer nunca manda rutas de repositorio ni de archivos arbitrarias: manda ids de proyecto y main resuelve la carpeta.',
          'Git: sin push forzado ni reset duro. GitHub: sin borrar, descartar, forzar ni fusionar PRs desde la IA.',
          'La IA no puede borrar tareas (solo descartarlas con motivo) ni eliminar proyectos.',
          'Eliminar un grupo pide la contraseña de tu usuario del sistema; viaja solo por la entrada estándar del proceso que la verifica.',
          'Los adjuntos se validan por su contenido (firma de bytes), no por la extensión, y el agente recibe la instrucción de tratarlos como datos y no obedecer instrucciones escondidas en ellos.'
        ]
      }
    ],
    relacionadas: ['permisos', 'flujo', 'datos', 'navegador']
  },

  {
    id: 'problemas',
    titulo: 'Si algo no funciona',
    icono: 'alerta',
    categoria: 'Referencia',
    gancho: 'Los fallos típicos y qué hacer con cada uno',
    resumen: 'Recorrido rápido por lo que falla más a menudo y su causa real, antes de ponerse a investigar.',
    paraQue: ['Resolver en un minuto lo que suele ser una sesión caducada, un puerto ocupado o una clave que falta.'],
    pasos: [
      { titulo: 'Vuelve a aparecer la pantalla de acceso', texto: 'La sesión venció o el servidor la rechazó: vuelve a entrar. Si el servidor no responde, revisa que esté levantado y qué dirección usa la app (ODESK_API_URL).' },
      { titulo: 'Un proveedor sale con «?»', texto: 'Su binario no está en el PATH que ve la app. Instálalo o pon el comando con su ruta completa en «Proveedores de IA».' },
      { titulo: 'El asistente dice que falta la clave', texto: 'El modo «api» necesita ANTHROPIC_API_KEY (del entorno o del proveedor claude). El modo suscripción necesita sesión de Claude (claude auth login).' },
      { titulo: 'No hay flujos ni grupos', texto: 'Son del modo «api»: en suscripción no están disponibles.' },
      { titulo: 'Las terminales desaparecieron al recargar', texto: 'Recargar la ventana mata sus procesos: es lo esperado, no un fallo.' },
      { titulo: 'El agente no carga mis agentes o skills', texto: 'Solo se cargan en terminales abiertas con ✦ y un proveedor claude, y con el recurso activado para ese proyecto o grupo.' },
      { titulo: 'Las herramientas de tareas fallan desde el CLI', texto: 'El servidor MCP no tiene datos propios: necesita Odesk Agent abierto para hablar con él.' },
      { titulo: 'git pide contraseña y falla', texto: 'La app no puede pedir contraseñas: usa una clave SSH con ssh-agent, un credential helper, o conecta GitHub con un token (https funciona entonces sin configurar nada).' },
      { titulo: 'El token de GitHub se pierde al cerrar', texto: 'Tu sistema no ofrece un llavero seguro, así que el token solo vive en memoria. Instala un gestor de claves del escritorio o vuelve a pegarlo cada sesión.' }
    ],
    relacionadas: ['cuenta', 'proveedores', 'asistente', 'github']
  }
]

/** Texto donde busca el filtro de la pantalla (todo el contenido de la sección). */
export function textoDe(s: Seccion): string {
  const partes = [
    s.titulo,
    s.gancho,
    s.resumen,
    s.donde ?? '',
    ...s.paraQue,
    ...s.pasos.flatMap((p) => [p.titulo, p.texto]),
    ...(s.bloques ?? []).flatMap((b) => [b.titulo, ...b.items]),
    ...(s.atajos ?? []).flatMap((a) => [a.tecla, a.que]),
    ...(s.limites ?? [])
  ]
  return partes.join(' ').toLowerCase()
}

const sinTildes = (t: string): string => t.normalize('NFD').replace(/\p{Diacritic}/gu, '')

/** Secciones que contienen todas las palabras buscadas (sin distinguir tildes ni mayúsculas). */
export function buscar(texto: string, secciones: Seccion[] = SECCIONES): Seccion[] {
  const palabras = sinTildes(texto.trim().toLowerCase()).split(/\s+/).filter(Boolean)
  if (palabras.length === 0) return secciones
  return secciones.filter((s) => {
    const contenido = sinTildes(textoDe(s))
    return palabras.every((p) => contenido.includes(p))
  })
}

export const CATEGORIAS: Categoria[] = ['Empezar', 'Terminales', 'Asistente de IA', 'Herramientas', 'Referencia']
