import type { VaultProvider } from './types'
import { githubVault } from './github'

/** Registry of vault providers, in display order. Add a provider = add a file + a line.
 *  GitHub is currently the only one: a vault is a repo, which gives files real
 *  history and portability, and works the same in every browser. */
export const vaultProviders: VaultProvider[] = [githubVault]

/** localStorage config namespace for a provider's fields. */
export const vaultNs = (id: string) => `vault.${id}`

export type { VaultProvider, VaultEntry, VaultFile, VaultContext, ConfigField } from './types'
export { VaultConflictError, isMediaPath, isTextPath } from './types'
