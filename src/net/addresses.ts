import ipaddr from 'ipaddr.js';

export type AddressClass = 'public' | 'private' | 'forbidden';

/**
 * Classifies an IP address for outbound requests.
 * - public: globally routable unicast.
 * - private: RFC 1918, unique local (fc00::/7) and carrier-grade NAT; reachable only for hosts explicitly
 *   listed in ALLOW_PRIVATE_HOSTS (demo targets on an internal Docker network).
 * - forbidden: never contacted. Loopback, link-local (including the 169.254.169.254 cloud metadata
 *   endpoint), unspecified, multicast, broadcast and every reserved or special-purpose range.
 * IPv4-mapped IPv6 addresses (::ffff:10.0.0.1) are classified as the IPv4 address they carry.
 */
export function classifyAddress(address: string): AddressClass {
  if (!ipaddr.isValid(address)) return 'forbidden';
  let ip = ipaddr.parse(address);
  if (ip.kind() === 'ipv6' && (ip as ipaddr.IPv6).isIPv4MappedAddress()) {
    ip = (ip as ipaddr.IPv6).toIPv4Address();
  }
  const range = ip.range();
  if (range === 'unicast') return 'public';
  if (range === 'private' || range === 'uniqueLocal' || range === 'carrierGradeNat') return 'private';
  return 'forbidden';
}

export function isIpLiteral(host: string): boolean {
  const bare = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  return ipaddr.isValid(bare);
}
