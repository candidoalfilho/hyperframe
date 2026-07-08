let counter = 0

/** id curto, único por sessão (não precisa ser criptográfico) */
export function uid(prefix = 'e'): string {
  counter = (counter + 1) % 0xffff
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${Math.floor(
    Math.random() * 0xffff,
  ).toString(36)}`
}
