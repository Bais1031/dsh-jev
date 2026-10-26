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
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-jev: settings dictionaries')
  const controller = new DshJevConfigCardController(ctx.configForms.get(DSH_JEV_NAMESPACE), {
    describe: async refs => await ctx.remote.credentials.describe(refs),
    set: async (ref, value) => await ctx.remote.credentials.set(ref, value),
  })
  ctx.effect(() => () => { controller.dispose() }, 'dsh-jev: settings form')
  ctx.effect(
    () => ctx.remote.$on('credentials/reference-updated', (ref: string) => { controller.refreshCredential(ref) }),
    'dsh-jev: credential invalidations',
  )
  ctx.effect(() => ctx.slots.inject('plugins.row.config', () => ctx.slots.register({
      name: 'plugins.row.config',
      key: 'dsh-jev#dsh-jev',
      locale: NS,
      inject: () => controller.inject(),
    }, DshJevConfigCard)), 'dsh-jev: row configuration')
}
