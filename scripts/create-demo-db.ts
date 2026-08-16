import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const DB_DIR = join(process.cwd(), 'datasets');
const DB_FILE = join(DB_DIR, 'demo.sqlite');

mkdirSync(DB_DIR, { recursive: true });

const db = new DatabaseSync(DB_FILE);

db.exec(`
  DROP TABLE IF EXISTS users;
  DROP TABLE IF EXISTS orders;
  DROP TABLE IF EXISTS products;

  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    age INTEGER NOT NULL,
    salary REAL NOT NULL,
    city TEXT NOT NULL
  );

  CREATE TABLE orders (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL,
    amount REAL NOT NULL
  );

  CREATE TABLE products (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    price REAL NOT NULL,
    stock INTEGER NOT NULL
  );
`);

// Deterministic data (same PRNG as the CSV generator).
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = ['Krishna', 'John', 'Alice', 'Bob', 'Charlie', 'Diana', 'Eve', 'Frank', 'Grace', 'Henry', 'Ivy', 'Jack', 'Kate', 'Liam', 'Mia', 'Noah', 'Olivia', 'Peter', 'Quinn', 'Rose', 'Sam', 'Tina', 'Uma', 'Victor', 'Wendy', 'Xavier', 'Yara', 'Zane', 'Aria', 'Ben', 'Cara', 'Derek'];
const INITIALS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const CITIES = ['Mumbai', 'Delhi', 'Bangalore', 'Hyderabad', 'Chennai', 'Kolkata', 'Pune', 'Ahmedabad', 'Jaipur', 'Lucknow', 'New York', 'London', 'Berlin', 'Tokyo', 'Sydney', 'Toronto'];
const PRODUCTS = ['Laptop', 'Mouse', 'Keyboard', 'Monitor', 'Headphones', 'Webcam', 'Desk', 'Chair', 'USB-C Cable', 'Docking Station', 'SSD', 'RAM'];

const rand = mulberry32(0x1234);

const insertUser = db.prepare('INSERT INTO users (id, name, age, salary, city) VALUES (?, ?, ?, ?, ?)');
const insertOrder = db.prepare('INSERT INTO orders (id, user_id, product_id, quantity, amount) VALUES (?, ?, ?, ?, ?)');
const insertProduct = db.prepare('INSERT INTO products (id, name, price, stock) VALUES (?, ?, ?, ?)');

const N = 50_000;
db.exec('BEGIN');
for (let i = 1; i <= N; i++) {
  insertUser.run(i, FIRST[Math.floor(rand() * FIRST.length)] + ' ' + INITIALS[Math.floor(rand() * INITIALS.length)], 16 + Math.floor(rand() * 50), 30_000 + Math.floor(rand() * 170_000), CITIES[Math.floor(rand() * CITIES.length)]);
}
for (let i = 1; i <= 30_000; i++) {
  insertOrder.run(i, 1 + Math.floor(rand() * N), 1 + Math.floor(rand() * 12), 1 + Math.floor(rand() * 5), 5 + Math.floor(rand() * 995));
}
for (let i = 1; i <= 1_000; i++) {
  insertProduct.run(i, PRODUCTS[Math.floor(rand() * PRODUCTS.length)], Math.floor(rand() * 500) + 5, Math.floor(rand() * 200));
}
db.exec('COMMIT');

console.log(`✓ ${DB_FILE} created (${N} users, 30000 orders, 1000 products)`);
db.close();
