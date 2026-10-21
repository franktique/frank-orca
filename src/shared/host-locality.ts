const IPV4_LOOPBACK = /^127(?:\.\d{1,3}){3}$/

/** True only for hosts that resolve to this machine's loopback or unspecified address. */
export function isLocalHost(host: string): boolean {
  const trimmed = host.trim().toLowerCase()
  if (trimmed === 'localhost' || trimmed.endsWith('.localhost')) {
    return true
  }
  const bare = trimmed.startsWith('[') && trimmed.endsWith(']') ? trimmed.slice(1, -1) : trimmed
  if (bare === '::1' || bare === '::' || bare === '0:0:0:0:0:0:0:1' || bare === '0.0.0.0') {
    return true
  }
  // IPv4-mapped loopback, e.g. ::ffff:127.0.0.1
  const mapped = bare.startsWith('::ffff:') ? bare.slice('::ffff:'.length) : bare
  return IPV4_LOOPBACK.test(mapped) && mapped.split('.').every((part) => Number(part) <= 255)
}
