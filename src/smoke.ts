import { loadConfig } from './config/env.js';
import { BydfiApiError, BydfiClient } from './bydfi/client.js';

const prettyPrint = (label: string, payload: unknown): void => {
  console.log(`\n=== ${label} ===`);
  console.log(JSON.stringify(payload, null, 2));
};

const main = async (): Promise<void> => {
  const config = loadConfig();
  const client = new BydfiClient(config);

  prettyPrint('Balance', await client.getBalance());
  prettyPrint('Positions', await client.getPositions());
  prettyPrint('Exchange Info', await client.getExchangeInfo());
};

main().catch((error) => {
  if (error instanceof BydfiApiError) {
    console.error(error.message);
    process.exit(1);
  }

  console.error(error);
  process.exit(1);
});
