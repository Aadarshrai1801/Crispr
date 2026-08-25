import { writeFileSync } from "node:fs";

const lines = [
  "ACME Corporation Employee Handbook (2024 Edition)",
  "",
  "Section 1: Late Reporting Penalties",
  "The maximum late-filing penalty for expense reports is $1,000 per violation.",
  "Penalties are waived for medical emergencies documented within 30 days.",
  "",
  "Section 2: Renewal Deadlines",
  "All contractor badge renewals must be completed before March 31 each year.",
  "Late renewals incur a $50 processing fee after April 15.",
  "",
  "Section 3: Remote Work Policy",
  "Employees may work remotely up to 3 days per week with manager approval.",
  "Fully remote arrangements require VP sign-off and annual review.",
];

const content = lines
  .map((l) => `(${l.replace(/([()\\])/g, "\\$1")}) Tj T*`)
  .join("\n");
const streamText = `BT\n/F1 11 Tf\n72 720 Td\n16 TL\n${content}\nET`;

const objects = [];
objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
objects[2] = "<< /Type /Pages /Kids [3 0 R] /Count 1 >>";
objects[3] =
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>";
objects[4] = `<< /Length ${Buffer.byteLength(streamText)} >>\nstream\n${streamText}\nendstream`;
objects[5] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";

let pdf = "%PDF-1.4\n";
const offsets = [0];
for (let i = 1; i < objects.length; i++) {
  offsets[i] = Buffer.byteLength(pdf);
  pdf += `${i} 0 obj\n${objects[i]}\nendobj\n`;
}
const xrefOffset = Buffer.byteLength(pdf);
pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
for (let i = 1; i < objects.length; i++) {
  pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
}
pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

writeFileSync("test-fixture.pdf", pdf, "latin1");
console.log("wrote test-fixture.pdf", Buffer.byteLength(pdf), "bytes");
