/* Seed a flagged query log for smoke-testing the correction flow. */
const Database = require("better-sqlite3");
const db = new Database("./data/crisp.db");
const user = db.prepare("SELECT id FROM users LIMIT 1").get().id;
const doc = db.prepare("SELECT id FROM documents LIMIT 1").get().id;
db.prepare(
  `INSERT OR REPLACE INTO query_logs (id, workspace_id, user_id, document_ids, question_text, answer_text, source_type, citations, feedback_status, attempt)
   VALUES ('ql_test1','ws_default',?,?,'What is the maximum late-filing penalty for expense reports?','The maximum late-filing penalty is 500 dollars per violation.','document','[]','flagged',0)`
).run(user, JSON.stringify([doc]));
console.log("seeded ql_test1 for doc", doc);
