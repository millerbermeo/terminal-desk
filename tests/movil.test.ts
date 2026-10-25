import { describe, expect, it } from 'vitest'
import {
  analizarDispositivos,
  analizarPrimerPlano,
  analizarTamano,
  analizarVolcadoUi,
  ayudaEstado,
  buscarPorTexto,
  codigoTecla,
  explicarErrorAdb,
  instantaneaMovil,
  motivoShellBloqueado,
  textoParaInput
} from '@shared/movil'
import { HERRAMIENTAS_ODESK } from '@shared/herramientas-odesk'
import { HERRAMIENTAS_MOVIL } from '@shared/movil-herramientas'
import { crearEjecutorOdesk, type ControlNavegador, type ServiciosOdesk } from '../src/main/core/herramientas-odesk'
import { permisosCli } from '../src/main/core/suscripcion'
import { localizarAdb } from '../src/main/movil'

const VOLCADO = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation="0">
<node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="com.tienda" content-desc="" checkable="false" checked="false" clickable="false" enabled="true" focusable="false" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[0,0][1080,2400]">
  <node index="0" text="Iniciar sesi&#243;n" resource-id="com.tienda:id/titulo" class="android.widget.TextView" package="com.tienda" content-desc="" checkable="false" checked="false" clickable="false" enabled="true" focusable="false" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[60,200][1020,300]" />
  <node index="1" text="ana@x.com" resource-id="com.tienda:id/correo" class="android.widget.EditText" package="com.tienda" content-desc="Correo" checkable="false" checked="false" clickable="true" enabled="true" focusable="true" focused="true" scrollable="false" long-clickable="true" password="false" selected="false" bounds="[60,400][1020,520]" />
  <node index="2" text="secreto" resource-id="com.tienda:id/clave" class="android.widget.EditText" package="com.tienda" content-desc="" checkable="false" checked="false" clickable="true" enabled="true" focusable="true" focused="false" scrollable="false" long-clickable="true" password="true" selected="false" bounds="[60,560][1020,680]" />
  <node index="3" text="Recordarme" resource-id="" class="android.widget.CheckBox" package="com.tienda" content-desc="" checkable="true" checked="false" clickable="true" enabled="true" focusable="true" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[60,720][500,800]" />
  <node index="4" text="" resource-id="com.tienda:id/entrar" class="android.view.ViewGroup" package="com.tienda" content-desc="" checkable="false" checked="false" clickable="true" enabled="false" focusable="true" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[60,860][1020,980]">
    <node index="0" text="Entrar &amp; seguir" resource-id="" class="android.widget.TextView" package="com.tienda" content-desc="" checkable="false" checked="false" clickable="false" enabled="true" focusable="false" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[400,890][680,950]" />
  </node>
  <node index="5" text="Oculto" resource-id="" class="android.widget.TextView" package="com.tienda" content-desc="" checkable="false" checked="false" clickable="false" enabled="true" focusable="false" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[0,0][0,0]" />
</node>
</hierarchy>`

describe('adb devices -l', () => {
  it('reconoce cada estado y sus datos', () => {
    const l = analizarDispositivos(`List of devices attached
R58M123ABC             device usb:1-2 product:a52qnsxx model:SM_A525F device:a52q transport_id:3
0123456789ABCDEF       unauthorized usb:1-3 transport_id:4
ZY22ABCDEF             no permissions (missing udev rules? user is in the plugdev group); see [http://developer.android.com/tools/device.html] usb:1-4
emulator-5554          offline transport_id:5
192.168.1.20:5555      device product:x model:Pixel_7 device:panther transport_id:6
`)
    expect(l.map((d) => [d.serie, d.estado])).toEqual([
      ['R58M123ABC', 'listo'],
      ['0123456789ABCDEF', 'sin_autorizar'],
      ['ZY22ABCDEF', 'sin_permiso_usb'],
      ['emulator-5554', 'desconectado'],
      ['192.168.1.20:5555', 'listo']
    ])
    expect(l[0]).toMatchObject({ modelo: 'SM A525F', usb: '1-2', red: false, emulador: false })
    expect(l[2]!.usb).toBe('1-4')
    expect(l[3]!.emulador).toBe(true)
    expect(l[4]).toMatchObject({ red: true, modelo: 'Pixel 7' })
    expect(analizarDispositivos('List of devices attached\n\n')).toEqual([])
  })
  it('explica qué hacer sin saltarse la autorización del teléfono', () => {
    expect(ayudaEstado({ estado: 'sin_autorizar', crudo: 'unauthorized' })).toMatch(/Permitir depuración USB/)
    expect(ayudaEstado({ estado: 'sin_permiso_usb', crudo: 'no permissions' }, 'linux')).toMatch(/udev.*plugdev/s)
    expect(ayudaEstado({ estado: 'listo', crudo: 'device' })).toBe('')
    expect(explicarErrorAdb("error: device 'X' not found")).toMatch(/desconectó/)
    expect(explicarErrorAdb('java.lang.SecurityException: Injecting to another application requires INJECT_EVENTS permission')).toMatch(/Xiaomi/)
    expect(explicarErrorAdb('Failure [INSTALL_FAILED_USER_RESTRICTED: Install canceled by user]')).toMatch(/Instalar vía USB/)
  })
})

describe('pantalla (uiautomator)', () => {
  const raiz = analizarVolcadoUi(VOLCADO)
  it('analiza el árbol con entidades y límites', () => {
    expect(raiz).toHaveLength(1)
    expect(raiz[0]!.hijos).toHaveLength(6)
    expect(raiz[0]!.hijos[0]!.texto).toBe('Iniciar sesión')
    expect(raiz[0]!.hijos[4]!.hijos[0]!.texto).toBe('Entrar & seguir')
    expect(raiz[0]!.hijos[1]!.limites).toEqual({ x1: 60, y1: 400, x2: 1020, y2: 520 })
  })
  it('la instantánea da refs a lo tocable, oculta contraseñas y omite lo invisible', () => {
    const { texto, elementos } = instantaneaMovil(raiz, ['Dispositivo: prueba'])
    expect(texto).toBe(
      [
        'Dispositivo: prueba',
        '- text "Iniciar sesión"',
        '- textbox "Correo" [ref=e1] valor="ana@x.com" (enfocado) #correo',
        '- textbox [ref=e2] valor="•••" #clave',
        '- checkbox "Recordarme" [ref=e3] (sin marcar)',
        '- clicable "Entrar & seguir" [ref=e4] (deshabilitado) #entrar'
      ].join('\n')
    )
    expect(elementos.get('e4')).toMatchObject({ x: 540, y: 920, desc: 'clicable «Entrar & seguir»' })
  })
  it('busca por texto prefiriendo lo tocable', () => {
    expect(buscarPorTexto(raiz, 'recordarme')?.clase).toBe('android.widget.CheckBox')
    expect(buscarPorTexto(raiz, 'Entrar')?.texto).toBe('Entrar & seguir')
    expect(buscarPorTexto(raiz, 'oculto')).toBeUndefined()
  })
  it('tamaño y app en primer plano', () => {
    expect(analizarTamano('Physical size: 1080x2400\nOverride size: 720x1600')).toEqual({ ancho: 720, alto: 1600 })
    expect(analizarTamano('Physical size: 1080x2400')).toEqual({ ancho: 1080, alto: 2400 })
    expect(analizarPrimerPlano('  topResumedActivity=ActivityRecord{a1b u0 com.tienda/.MainActivity t12}')).toBe('com.tienda/.MainActivity')
    expect(analizarPrimerPlano('  mCurrentFocus=Window{1 u0 com.android.launcher3/com.android.launcher3.Launcher}')).toBe('com.android.launcher3/com.android.launcher3.Launcher')
  })
})

describe('entrada', () => {
  it('texto para input con escapes del shell del teléfono', () => {
    expect(textoParaInput('hola mundo')).toBe("'hola%smundo'")
    expect(textoParaInput("it's")).toBe(`'it'\\''s'`)
    expect(textoParaInput('a;rm -rf /')).toBe("'a;rm%s-rf%s/'")
    expect(() => textoParaInput('canción')).toThrow(/ASCII/)
  })
  it('teclas por nombre, KEYCODE o número', () => {
    expect(codigoTecla('atrás')).toBe(4)
    expect(codigoTecla('KEYCODE_ENTER')).toBe(66)
    expect(codigoTecla('187')).toBe(187)
    expect(() => codigoTecla('patata')).toThrow(/desconocida/)
  })
  it('el shell no eleva privilegios ni rompe el teléfono', () => {
    expect(motivoShellBloqueado('dumpsys battery')).toBeNull()
    expect(motivoShellBloqueado('getprop ro.build.version.release')).toBeNull()
    expect(motivoShellBloqueado('su -c id')).toMatch(/privilegios/)
    expect(motivoShellBloqueado('ls; su')).toMatch(/privilegios/)
    expect(motivoShellBloqueado('reboot bootloader')).toMatch(/inservible/)
    expect(motivoShellBloqueado('rm -rf /sdcard')).toMatch(/Borrado/)
    expect(motivoShellBloqueado('settings put global adb_enabled 0')).toMatch(/seguridad/)
    expect(motivoShellBloqueado('pm clear com.tienda')).toMatch(/borren/)
    expect(motivoShellBloqueado('cmd package uninstall com.tienda')).toMatch(/borren/)
    expect(motivoShellBloqueado('pm list packages')).toBeNull()
  })
})

describe('herramientas movil_*', () => {
  it('están en el servidor odesk con permisos según el riesgo', () => {
    for (const h of HERRAMIENTAS_MOVIL) expect(HERRAMIENTAS_ODESK).toContain(h)
    expect(permisosCli('preguntar', [], true)).toContain('mcp__odesk__movil_instantanea')
    expect(permisosCli('preguntar', [], true)).not.toContain('mcp__odesk__movil_tocar')
    expect(permisosCli('ediciones', [], true)).toContain('mcp__odesk__movil_instalar')
    expect(permisosCli('ediciones', [], true)).not.toContain('mcp__odesk__movil_shell')
    expect(permisosCli('autonomo', [], true)).toContain('mcp__odesk__movil_shell')
  })
  it('resuelve el APK relativo a la carpeta del proyecto', async () => {
    const llamadas: Record<string, unknown>[] = []
    const control: ControlNavegador = { ejecutar: async (_n, e) => (llamadas.push(e), { texto: 'ok' }) }
    const s: ServiciosOdesk = { tareas: {} as never, github: {} as never, carpetaDe: async (id) => `/proyectos/${id}`, movil: () => control }
    const ejecutar = crearEjecutorOdesk(s)
    await ejecutar('movil_instalar', { apk: 'app/build/app-debug.apk' }, { proyectoId: 'p1' })
    await ejecutar('movil_instalar', { apk: '/tmp/x.apk' }, { proyectoId: 'p1' })
    expect(llamadas.map((e) => e.apk)).toEqual(['/proyectos/p1/app/build/app-debug.apk', '/tmp/x.apk'])
    expect(await ejecutar('movil_instalar', { apk: 'rel.apk' })).toMatchObject({ error: true, texto: expect.stringMatching(/relativa/) })
    expect(await crearEjecutorOdesk({ ...s, movil: () => undefined })('movil_dispositivos', {})).toMatchObject({ error: true })
  })
  it('localiza adb por variable, PATH o el SDK', () => {
    expect(localizarAdb({ ODESK_ADB: '/no/existe', PATH: '' })).not.toBe('/no/existe')
    expect(localizarAdb({ ODESK_ADB: process.execPath })).toBe(process.execPath)
  })
})
