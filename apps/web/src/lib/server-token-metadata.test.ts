import test from 'node:test';
import assert from 'node:assert/strict';
import type { Asset } from './domain.ts';
import { AAVE_TOKEN_ENDPOINT, createTokenMetadataLoader } from './server-token-metadata.ts';

const address = '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0';
const asset: Asset = { id: `31337/${address.toLowerCase()}`, tokenId: `31337/${address.toLowerCase()}`, address, symbol: 'wstETH', name: 'Wrapped liquid staked Ether 2.0', decimals: 18 };
const token = { address, chain: { chainId: 1 }, info: { name: 'Wrapped stETH', icon: 'https://images.aave.com/token.png', decimals: 18 } };

test('Aave metadata uses the fork source chain and preserves native token identities', async () => {
  let calls = 0;
  const load = createTokenMetadataLoader(async (url, init) => {
    calls += 1;
    assert.equal(url, AAVE_TOKEN_ENDPOINT);
    const body = JSON.parse(init!.body as string);
    assert.deepEqual(body.variables.request.query.tokens, [{ chainId: 1, address: address.toLowerCase() }]);
    return Response.json({ data: { swappableTokens: [null, token, { ...token, address: '0x0000000000000000000000000000000000000001' }] } });
  });
  const [first, second] = await Promise.all([load([asset]), load([asset])]);
  assert.deepEqual(first, [{ ...asset, name: token.info.name, icon: token.info.icon }]);
  assert.deepEqual(first, second);
  assert.equal(calls, 1, 'concurrent requests share the cached metadata lookup');
  assert.deepEqual(await load([asset]), first);
  assert.equal(calls, 1);
});

test('unavailable or mismatched metadata leaves the verified inventory usable', async () => {
  const responses = [
    () => Response.json({ data: { swappableTokens: [null] } }),
    () => Response.json({ data: { swappableTokens: [{ ...token, chain: { chainId: 10 } }] } }),
    () => Response.json({ data: { swappableTokens: [{ ...token, info: { ...token.info, decimals: 6 } }] } }),
    () => Response.json({ errors: [{ message: 'unavailable' }] }),
    () => new Response('unavailable', { status: 503 }),
    () => new Response('invalid JSON'),
    () => { throw new Error('network timeout'); },
  ];
  for (const response of responses) {
    const load = createTokenMetadataLoader(async () => response());
    assert.deepEqual(await load([asset]), [asset]);
  }
});

test('metadata rejects untrusted icon URLs and does not request an empty catalog', async () => {
  const load = createTokenMetadataLoader(async () => Response.json({ data: { swappableTokens: [{ ...token, info: { ...token.info, icon: 'https://example.com/token.png' } }] } }));
  assert.equal((await load([asset]))[0].icon, undefined);
  const empty = createTokenMetadataLoader(async () => { assert.fail('empty inventory must not fetch'); });
  assert.deepEqual(await empty([]), []);
});

test('catalogs are matched by address, independent of response order', async () => {
  const assets = Array.from({ length: 25 }, (_, index): Asset => ({ ...asset, id: `31337/${index}`, address: `0x${index.toString(16).padStart(40, '0')}` }));
  let calls = 0;
  const load = createTokenMetadataLoader(async (_, init) => {
    calls += 1;
    const { variables } = JSON.parse(init!.body as string);
    const requests = variables.request.query.tokens as { address: string }[];
    return Response.json({ data: { swappableTokens: requests.reverse().map(request => ({ ...token, address: request.address })) } });
  });
  const result = await load(assets);
  assert.equal(calls, 1);
  assert.deepEqual(result.map(item => item.id), assets.map(item => item.id));
  assert.ok(result.every(item => item.icon === token.info.icon));
});
