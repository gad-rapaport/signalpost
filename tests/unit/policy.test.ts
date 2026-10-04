import { describe, expect, it } from 'vitest';
import { classifyAddress } from '../../src/net/addresses.js';
import {
  checkTarget,
  hostAllowed,
  parseTarget,
  PolicyError,
  resolveTarget,
  type OutboundPolicy,
} from '../../src/net/policy.js';

const policy: OutboundPolicy = {
  allowedHosts: ['demo-api', 'example.org', '*.status.example.net', '203.0.113.7'],
  allowPrivateHosts: ['demo-api'],
  allowedPorts: [80, 443, 8080],
};

const reasonOf = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'allowed';
  } catch (err) {
    if (err instanceof PolicyError) return err.reason;
    throw err;
  }
};
const resolverFor =
  (...addresses: string[]) =>
  async () =>
    addresses.map((address) => ({ address, family: (address.includes(':') ? 6 : 4) as 4 | 6 }));

describe('address classification', () => {
  it.each([
    ['93.184.215.14', 'public'],
    ['8.8.8.8', 'public'],
    ['2606:4700:4700::1111', 'public'],
    ['10.1.2.3', 'private'],
    ['172.20.0.5', 'private'],
    ['192.168.1.10', 'private'],
    ['100.64.0.1', 'private'],
    ['fd12:3456::1', 'private'],
    ['::ffff:10.0.0.1', 'private'],
    ['127.0.0.1', 'forbidden'],
    ['127.10.20.30', 'forbidden'],
    ['::1', 'forbidden'],
    ['::ffff:127.0.0.1', 'forbidden'],
    ['169.254.169.254', 'forbidden'],
    ['fe80::1', 'forbidden'],
    ['0.0.0.0', 'forbidden'],
    ['224.0.0.251', 'forbidden'],
    ['255.255.255.255', 'forbidden'],
    ['192.0.2.10', 'forbidden'],
    ['198.18.0.1', 'forbidden'],
    ['not-an-ip', 'forbidden'],
  ])('%s is %s', (ip, cls) => {
    expect(classifyAddress(ip)).toBe(cls);
  });
});

describe('static target rules', () => {
  it('matches exact hosts and subdomain wildcards only', () => {
    expect(hostAllowed('example.org', policy.allowedHosts)).toBe(true);
    expect(hostAllowed('EXAMPLE.ORG.', policy.allowedHosts)).toBe(true);
    expect(hostAllowed('www.example.org', policy.allowedHosts)).toBe(false);
    expect(hostAllowed('api.status.example.net', policy.allowedHosts)).toBe(true);
    expect(hostAllowed('status.example.net', policy.allowedHosts)).toBe(false);
    expect(hostAllowed('evilstatus.example.net', policy.allowedHosts)).toBe(false);
  });

  it.each([
    ['ftp://example.org/', 'scheme'],
    ['file:///etc/passwd', 'scheme'],
    ['gopher://example.org/', 'scheme'],
    ['not a url', 'scheme'],
    ['https://user:secret@example.org/', 'credentials'],
    ['https://example.com/', 'host'],
    ['http://169.254.169.254/latest/meta-data/', 'host'],
    ['http://localhost/', 'host'],
    ['https://example.org:8443/', 'port'],
    ['http://example.org:22/', 'port'],
  ])('refuses %s (%s)', (url, reason) => {
    expect(() => parseTarget(url, policy)).toThrow(PolicyError);
    try {
      parseTarget(url, policy);
    } catch (err) {
      expect((err as PolicyError).reason).toBe(reason);
    }
  });

  it('accepts allowlisted targets and drops the fragment', () => {
    const t = parseTarget('https://example.org/path?q=1#frag', policy);
    expect(t.url.toString()).toBe('https://example.org/path?q=1');
    expect(t.port).toBe(443);
    expect(parseTarget('http://demo-api:8080/health', policy).port).toBe(8080);
  });
});

describe('DNS validation', () => {
  it('accepts a public answer and returns the address to pin', async () => {
    const t = parseTarget('https://example.org/', policy);
    await expect(resolveTarget(t, policy, resolverFor('93.184.215.14'))).resolves.toEqual({
      address: '93.184.215.14',
      family: 4,
    });
  });

  it('blocks an allowlisted name that resolves to a private address (DNS rebinding)', async () => {
    const t = parseTarget('https://example.org/', policy);
    expect(await reasonOf(resolveTarget(t, policy, resolverFor('10.0.0.8')))).toBe('address');
  });

  it('blocks when any one of several answers is internal', async () => {
    const t = parseTarget('https://example.org/', policy);
    expect(await reasonOf(resolveTarget(t, policy, resolverFor('93.184.215.14', '127.0.0.1')))).toBe(
      'address',
    );
  });

  it('lets listed private hosts reach private addresses, never loopback or metadata', async () => {
    const t = parseTarget('http://demo-api:8080/', policy);
    expect(await reasonOf(resolveTarget(t, policy, resolverFor('172.20.0.5')))).toBe('allowed');
    expect(await reasonOf(resolveTarget(t, policy, resolverFor('127.0.0.1')))).toBe('address');
    expect(await reasonOf(resolveTarget(t, policy, resolverFor('169.254.169.254')))).toBe('address');
  });

  it('reports names that do not resolve', async () => {
    const t = parseTarget('https://example.org/', policy);
    const failing = async () => {
      throw new Error('ENOTFOUND');
    };
    expect(await reasonOf(resolveTarget(t, policy, failing))).toBe('dns');
    expect(await reasonOf(resolveTarget(t, policy, resolverFor()))).toBe('dns');
  });

  it('checks IP literals without DNS, only when listed exactly', async () => {
    expect(await reasonOf(checkTarget('http://203.0.113.7/', policy))).toBe('address');
    expect(await reasonOf(checkTarget('http://203.0.113.8/', policy))).toBe('host');
  });

  it('prefers IPv4 when both families resolve', async () => {
    const t = parseTarget('https://example.org/', policy);
    await expect(
      resolveTarget(t, policy, resolverFor('2606:2800:21f:cb07:6820:80da:af6b:8b2c', '93.184.215.14')),
    ).resolves.toEqual({
      address: '93.184.215.14',
      family: 4,
    });
  });
});
