import type { VaultProvider } from './types'
import { githubVault } from './github'
import { localFolderVault } from './localFolder'

/** Registry of vault providers, in display order. Add a provider = add a file + a line. */
export const vaultProviders: VaultProvider[] = [githubVault, localFolderVault]

/** localStorage config namespace for a provider's fields. */
export const vaultNs = (id: string) => `vault.${id}`

export type { VaultProvider, VaultEntry, VaultFile, VaultContext, ConfigField } from './types'
export { VaultConflictError } from './types'
