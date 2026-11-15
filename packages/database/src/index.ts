import { AniScrollDatabase } from './db';
import { ensureSeedData } from './seed';

export * from './db';
export * from './seed';

let sharedDb: AniScrollDatabase | null = null;

export function getDatabase(): AniScrollDatabase {
  if (!sharedDb) {
    sharedDb = new AniScrollDatabase();
    ensureSeedData(sharedDb);
  }
  return sharedDb;
}
