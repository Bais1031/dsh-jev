/** Browser half registering dsh-jev configuration into the Plugins page. */

import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { DshJevConfigCard } from './DshJevConfigCard.js'
import { DSH_JEV_NAMESPACE, DshJevConfigCardController } from './config-card-controller.js'
import { en, zh, type DshJevSettingsLocaleKey } from './locales.js'
import dshJevRemote from '../remote.js'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** dsh-jev configuration page copy. */
    'dshJev.settings': DshJevSettingsLocaleKey
  }
}

/** Locale namespace owned by this browser plugin. */
export const NS = 'dshJev.settings'
/** Required Client services. */
export const inject = ['slots', 'locale', 'remote', 'remote.credentials', 'configForms']

/**
 * Register the page while the Host serves the dsh-jev configuration namespace.
 * @param ctx - Browser plugin context.
 */
export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  const unmountRemote = await ctx.remote.$mount(dshJevRemote)
  let ui: ReturnType<ClientContext['inject']> | undefined
  try {
    ui = ctx.inject([...inject, 'remote.dshJev'], (remoteCtx) => {
      remoteCtx.effect(() => remoteCtx.locale.register(NS, { zh, en }), 'dsh-jev: settings dictionaries')
      const controller = new DshJevConfigCardController(remoteCtx.configForms.get(DSH_JEV_NAMESPACE), {
        describe: async refs => await remoteCtx.remote.credentials.describe(refs),
        set: async (ref, value) => await remoteCtx.remote.credentials.set(ref, value),
      }, {
        testConnection: async () => {
          const result = await remoteCtx.remote.dshJev.testConnection()
          if (!result.ok) return { ok: false, code: result.error.code, retryable: false }
          return result.value
        },
        latestSessionSummary: async () => {
          const result = await remoteCtx.remote.dshJev.latestSessionSummary()
          if (!result.ok) throw result.error
          return result.value
        },
      })
      remoteCtx.effect(() => () => { controller.dispose() }, 'dsh-jev: settings form')
      remoteCtx.effect(
        () => remoteCtx.remote.$on('credentials/reference-updated', (ref: string) => { controller.refreshCredential(ref) }),
        'dsh-jev: credential invalidations',
      )
      remoteCtx.effect(() => remoteCtx.slots.inject('plugins.row.config', () => remoteCtx.slots.register({
        name: 'plugins.row.config',
        key: 'dsh-jev#dsh-jev',
        locale: NS,
        inject: () => controller.inject(),
      }, DshJevConfigCard)), 'dsh-jev: row configuration')
    })
    await ui
    return async () => {
      await ui?.dispose()
      await unmountRemote()
    }
  } catch (error: unknown) {
    await ui?.dispose()
    await unmountRemote()
    throw error
  }
}
