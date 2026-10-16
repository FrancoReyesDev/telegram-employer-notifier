const sha256 = (value: string) => crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))

// Comparacion en tiempo constante. Sin secreto configurado, rechaza.
export const matchesSecret = async (provided: string | undefined, expected: string | undefined): Promise<boolean> => {
  if (!provided || !expected) return false
  const [providedHash, expectedHash] = await Promise.all([sha256(provided), sha256(expected)])
  return crypto.subtle.timingSafeEqual(providedHash, expectedHash)
}
