/* Measure embedding similarity between correction question and paraphrases. */
const { pipeline } = require("@huggingface/transformers");

async function main() {
  const extractor = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
  const texts = [
    "What is the maximum late-filing penalty for expense reports?",
    "What is the maximum late-filing penalty for expense reports?\nTopics: late filing, penalty",
    "What's the maximum late-filing penalty?",
    "How much can I be fined for submitting my expense report late?",
    "How much is the fine if I file an expense report late?",
    "What happens if my expense report is submitted after the deadline?",
    "What is the remote work policy?",
  ];
  const out = await extractor(texts, { pooling: "mean", normalize: true });
  const vecs = out.tolist();
  const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
  const base = vecs[1]; // indexed text includes topic tags
  const baseNoTags = vecs[0];
  for (let i = 2; i < texts.length; i++) {
    console.log(
      `${dot(base, vecs[i]).toFixed(3)} (no-tags ${dot(baseNoTags, vecs[i]).toFixed(3)})  <- "${texts[i]}"`
    );
  }
}
main().catch(console.error);
