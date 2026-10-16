import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ProveedorAnthropic } from '../src/main/core/agents/llm/anthropic'
import { ejecutarSuite } from '../src/main/core/evals/ejecutor'
import { AlmacenInformes, compararInformes } from '../src/main/core/evals/informes'
import { SUITES } from '../src/main/core/evals/suites'
import { DIR } from '../src/main/proyectos'

const clave = process.env.ANTHROPIC_API_KEY
const MODELO = process.env.EVAL_MODELO ?? 'claude-sonnet-5-5'
const informes = new AlmacenInformes(join(DIR, 'evals'))

describe.skipIf(!clave)('evals con el modelo real', () => {
  for (const suite of SUITES) {
    it(`suite «${suite.id}» supera el umbral`, async () => {
      const llm = new ProveedorAnthropic(clave!, MODELO)
      const anterior = (await informes.listar(suite.id, 1))[0]
      const informe = await ejecutarSuite(suite, { llm, modelo: MODELO }, { alCaso: (r) => console.log(`${r.pasa ? 'OK  ' : 'FALLA'} ${r.id} (${r.pasos} pasos, ${r.duracionMs} ms)`) })
      await informes.guardar(informe)
      for (const c of informe.casos.filter((c) => !c.pasa))
        console.log(`  ✗ ${c.id}: ${c.aserciones.filter((a) => !a.ok).map((a) => `${a.tipo} -> ${a.detalle}`).join(' | ') || c.error}`)
      if (anterior) console.log('  vs. anterior:', compararInformes(anterior, informe))
      console.log(`  tasa ${(informe.tasa * 100).toFixed(0)} % (umbral ${(informe.umbral * 100).toFixed(0)} %), ${informe.uso.tokensEntrada + informe.uso.tokensSalida} tokens`)
      expect(informe.superaUmbral).toBe(true)
    })
  }
})
