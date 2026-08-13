import { safeStorage } from 'electron'
import type { CredentialDecryption, CredentialProtector } from './secureCredentials'

export class ElectronCredentialProtector implements CredentialProtector {
  isEncryptionAvailable(): boolean {
    return safeStorage.isEncryptionAvailable()
  }

  encryptString(value: string): Promise<Buffer> {
    return safeStorage.encryptStringAsync(value)
  }

  async decryptString(value: Buffer): Promise<CredentialDecryption> {
    const result = await safeStorage.decryptStringAsync(value)
    if (!result.result) {
      throw new Error('The operating system could not decrypt the cloud credential store.')
    }
    return { value: result.result, shouldReEncrypt: result.shouldReEncrypt }
  }
}
