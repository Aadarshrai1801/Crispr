const Database = require('better-sqlite3');
const db = new Database('data/crisp.db');
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
const counts = {};
for (const t of tables) {
  const r = db.prepare('SELECT count(*) AS n FROM ' + t.name).get();
  counts[t.name] = r.n;
}
console.log(JSON.stringify(counts, null, 2));
db.close();
