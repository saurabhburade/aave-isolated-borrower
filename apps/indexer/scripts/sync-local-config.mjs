import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../../../');
const manifestPath = process.env.AAVE_DEPLOYMENT_MANIFEST ?? path.join(root, 'contracts/config/local.json');
const configPath = path.join(import.meta.dirname, '../config.yaml');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
if (manifest.chainId !== 31337 || !/^https?:\/\/(127\.0\.0\.1|localhost):8557$/.test(manifest.rpcUrl)) throw new Error('Refusing to configure a non-local or non-31337 indexer.');
if (!manifest.factory || /^0x0{40}$/i.test(manifest.factory)) throw new Error('Verified factory address is required.');
const config = `# Generated from ${manifestPath}; do not edit by hand.
name: aave-isolated-indexer
description: Chain-qualified position history for owner-controlled Aave V3/V4 accounts.
contracts:
  - name: PositionFactory
    events:
      - event: "PositionCreated(address indexed owner,address indexed account,address indexed venue,uint8 version,bytes32 salt)"
  - name: PositionAccount
    events:
      - event: "PositionAction(address indexed owner,uint8 indexed kind,address indexed token,uint256 reserveId,uint256 amount,bool enabled)"
      - event: "AccountExecuted(address indexed owner,uint256 actionCount)"
chains:
  - id: 31337
    start_block: ${manifest.forkBlock ?? 0}
    rpc:
      url: ${manifest.rpcUrl}
      for: sync
    contracts:
      - name: PositionFactory
        address: "${manifest.factory}"
      - name: PositionAccount
`;
await writeFile(configPath, config, 'utf8');
console.log(`Wrote ${configPath}`);
