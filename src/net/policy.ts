import { lookup as dnsLookup } from 'node:dns/promises';
import { classifyAddress, isIpLiteral } from './addresses.js';

export interface OutboundPolicy {
  allowedHosts: string[];
  allowPrivateHosts: string[];
  allowedPorts: number[];
}

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

export type Resolver = (host: string) => Promise<ResolvedAddress[]>;

export const systemResolver: Resolver = async (host) =>
  (await dnsLookup(host, { all: true, verbatim: true })).map((a) => ({
    address: a.address,
    family: a.family === 6 ? 6 : 4,
  }));

export interface ParsedTarget {
  url: URL;
  host: string;
  port: number;
}

/** A policy refusal, with a message that can be shown to an administrator as is. */
export class PolicyError extends Error {
  constructor(
    readonly reason: 'scheme' | 'credentials' | 'host' | 'port' | 'ip_literal' | 'dns' | 'address',
    message: string,
  ) {
    super(message);
  }
}

export function hostAllowed(host: string, allowed: readonly string[]): boolean {
  const h = host.toLowerCase().replace(/\.$/, '');
  return allowed.some((rule) =>
    rule.startsWith('*.') ? h.endsWith(rule.slice(1)) && h.length > rule.length - 1 : h === rule,
  );
}

/** Static checks that need no network: scheme, credentials, allowlisted host and port. */
export function parseTarget(raw: string, policy: OutboundPolicy): ParsedTarget {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new PolicyError('scheme', 'Not a valid URL.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new PolicyError('scheme', 'Only http and https URLs can be monitored.');
  }
  if (url.username || url.password) {
    throw new PolicyError(
      'credentials',
      'URLs with credentials are not allowed; credentials would be stored and logged.',
    );
  }
  const host = url.hostname.toLowerCase();
  const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80;
  if (!hostAllowed(host, policy.allowedHosts)) {
    throw new PolicyError('host', `"${host}" is not on the outbound allowlist (ALLOWED_HOSTS).`);
  }
  if (isIpLiteral(host) && !policy.allowedHosts.includes(host)) {
    throw new PolicyError('ip_literal', 'IP addresses must be listed exactly in ALLOWED_HOSTS.');
  }
  if (!policy.allowedPorts.includes(port)) {
    throw new PolicyError(
      'port',
      `Port ${port} is not allowed (ALLOWED_PORTS: ${policy.allowedPorts.join(', ')}).`,
    );
  }
  url.hash = '';
  return { url, host, port };
}

/**
 * Resolves the host and checks every address it resolves to. Returns one address to connect to; the caller
 * pins the connection to it, so a second DNS answer (rebinding) can never redirect the request.
 */
export async function resolveTarget(
  target: ParsedTarget,
  policy: OutboundPolicy,
  resolve: Resolver = systemResolver,
): Promise<ResolvedAddress> {
  let addresses: ResolvedAddress[];
  const bare = target.host.startsWith('[') ? target.host.slice(1, -1) : target.host;
  if (isIpLiteral(bare)) {
    addresses = [{ address: bare, family: bare.includes(':') ? 6 : 4 }];
  } else {
    try {
      addresses = await resolve(bare);
    } catch {
      throw new PolicyError('dns', `"${bare}" does not resolve.`);
    }
  }
  if (addresses.length === 0) throw new PolicyError('dns', `"${bare}" does not resolve.`);
  const privateOk = policy.allowPrivateHosts.includes(bare);
  for (const a of addresses) {
    const cls = classifyAddress(a.address);
    if (cls === 'forbidden' || (cls === 'private' && !privateOk)) {
      throw new PolicyError(
        'address',
        `"${bare}" resolves to ${a.address}, a ${cls === 'private' ? 'private' : 'reserved or internal'} address.`,
      );
    }
  }
  // Prefer IPv4 when both families are present; the container networks here are IPv4.
  return addresses.find((a) => a.family === 4) ?? addresses[0]!;
}

/** Full check used when saving a monitor: static rules plus DNS. */
export async function checkTarget(raw: string, policy: OutboundPolicy, resolve?: Resolver) {
  const target = parseTarget(raw, policy);
  const address = await resolveTarget(target, policy, resolve);
  return { target, address };
}
