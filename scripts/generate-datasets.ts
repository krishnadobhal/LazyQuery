import { createWriteStream, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const DATASETS_DIR = join(process.cwd(), 'datasets');

// Deterministic PRNG so datasets are reproducible.
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST_NAMES = [
  'Krishna', 'John', 'Alice', 'Bob', 'Charlie', 'Diana', 'Eve', 'Frank',
  'Grace', 'Henry', 'Ivy', 'Jack', 'Kate', 'Liam', 'Mia', 'Noah',
  'Olivia', 'Peter', 'Quinn', 'Rose', 'Sam', 'Tina', 'Uma', 'Victor',
  'Wendy', 'Xavier', 'Yara', 'Zane', 'Aria', 'Ben', 'Cara', 'Derek',
];

const LAST_INITIALS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

const CITIES = [
  'Mumbai', 'Delhi', 'Bangalore', 'Hyderabad', 'Chennai', 'Kolkata',
  'Pune', 'Ahmedabad', 'Jaipur', 'Lucknow', 'New York', 'London',
  'Berlin', 'Tokyo', 'Sydney', 'Toronto',
];

const PRODUCTS = [
  'Laptop', 'Mouse', 'Keyboard', 'Monitor', 'Headphones', 'Webcam',
  'Desk', 'Chair', 'USB-C Cable', 'Docking Station', 'SSD', 'RAM',
];

interface Dataset {
  name: string;
  rows: number;
  generate: (rand: () => number, row: number) => string[];
}

const DATASETS: Dataset[] = [
  {
    name: 'users',
    rows: 50_000,
    generate: (rand, row) => [
      String(row + 1),
      FIRST_NAMES[Math.floor(rand() * FIRST_NAMES.length)] + ' ' + LAST_INITIALS[Math.floor(rand() * LAST_INITIALS.length)],
      String(16 + Math.floor(rand() * 50)), // age 16-65
      String(30_000 + Math.floor(rand() * 170_000)), // salary
      CITIES[Math.floor(rand() * CITIES.length)],
    ],
  },
  {
    name: 'orders',
    rows: 30_000,
    generate: (rand, row) => [
      String(row + 1),
      String(1 + Math.floor(rand() * 50_000)), // user_id FK
      String(1 + Math.floor(rand() * 12)), // product_id FK
      String(1 + Math.floor(rand() * 5)), // quantity
      String(5 + Math.floor(rand() * 995)), // amount
    ],
  },
  {
    name: 'products',
    rows: 1_000,
    generate: (rand, row) => [
      String(row + 1),
      PRODUCTS[Math.floor(rand() * PRODUCTS.length)],
      String(Math.floor(rand() * 500) + 5), // price
      String(0 + Math.floor(rand() * 200)), // stock
    ],
  },
];

async function generate(dataset: Dataset): Promise<void> {
  const file = join(DATASETS_DIR, `${dataset.name}.csv`);
  mkdirSync(dirname(file), { recursive: true });
  const rand = mulberry32(hashCode(dataset.name));
  const stream = createWriteStream(file);

  const headers = dataset.name === 'users'
    ? ['id', 'name', 'age', 'salary', 'city']
    : dataset.name === 'orders'
      ? ['id', 'user_id', 'product_id', 'quantity', 'amount']
      : ['id', 'name', 'price', 'stock'];

  stream.write(headers.join(',') + '\n');
  for (let row = 0; row < dataset.rows; row++) {
    stream.write(dataset.generate(rand, row).join(',') + '\n');
    // Backpressure: yield every 10k rows so the event loop stays free.
    if (row % 10_000 === 0 && row > 0) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }
  await new Promise<void>((resolve, reject) => {
    stream.end((err?: Error | null) => (err ? reject(err) : resolve()));
  });
  console.log(`✓ ${dataset.name}.csv — ${dataset.rows} rows`);
}

function hashCode(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return h;
}

async function main(): Promise<void> {
  const rowOverride = process.argv[2] ? parseInt(process.argv[2], 10) : NaN;
  console.log(`Generating datasets into ${DATASETS_DIR}`);
  for (const dataset of DATASETS) {
    if (!Number.isNaN(rowOverride)) dataset.rows = rowOverride;
    await generate(dataset);
  }
  console.log('Done.');
}

main();
