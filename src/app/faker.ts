/**
 * bombadil-kit/faker: deterministic mock data, so a fuzz trace replays against
 * the data it saw.
 *
 *   import { faker } from '@faker-js/faker';
 *   import { seedFaker } from 'bombadil-kit/faker';
 *   export const { mockRandom, mockNow } = seedFaker(faker, import.meta.env);
 *
 * With VITE_MOCK_SEED set (bombadil-kit.json's server.env, from --seed),
 * faker is seeded and its dates count from VITE_MOCK_REF_DATE (--ref-date;
 * default the start of today, UTC). Route every other random choice and "now"
 * in the mock layer through mockRandom and mockNow. Call it before any mock
 * data is built. Takes the app's own faker, so no version is imposed.
 */
export interface MockSeed {
  seed: number;
  refDate: Date;
}

/** The parts of a Faker instance this uses. */
export interface FakerLike {
  seed(seed: number): unknown;
  setDefaultRefDate(date: Date): void;
  defaultRefDate(): Date;
  number: { float(options: { min: number; max: number }): number };
}

export const parseMockSeed = (env: Record<string, unknown>): MockSeed | undefined => {
  const seed = Number.parseInt(String(env.VITE_MOCK_SEED ?? ''), 10);
  if (Number.isNaN(seed)) return undefined;
  const ref = String(env.VITE_MOCK_REF_DATE ?? '');
  const day = /^\d{4}-\d{2}-\d{2}$/.test(ref) ? ref : new Date().toISOString().slice(0, 10);
  return { seed, refDate: new Date(`${day}T00:00:00Z`) };
};

/** Seeds `faker` and pins the date it counts from. */
export const applySeed = (faker: FakerLike, { seed, refDate }: MockSeed): void => {
  faker.seed(seed);
  faker.setDefaultRefDate(refDate);
};

export const seedFaker = (faker: FakerLike, env: Record<string, unknown>) => {
  const seeded = parseMockSeed(env);
  if (seeded) applySeed(faker, seeded);
  return {
    seeded,
    // Always through faker, seeded or not: unseeded it's as random as
    // Math.random, and whoever seeds faker later (a test) seeds these too.
    /** Math.random for the mock layer. */
    mockRandom: (): number => faker.number.float({ min: 0, max: 1 }),
    /** Now, for the mock layer: faker's reference date, which is the clock until one is set. */
    mockNow: (): number => faker.defaultRefDate().getTime(),
  };
};
