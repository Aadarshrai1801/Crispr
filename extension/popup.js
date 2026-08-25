const originInput = document.getElementById("origin");
const goButton = document.getElementById("go");
const status = document.getElementById("status");

// Remember the last app origin.
chrome.storage.local.get(["crispOrigin"], ({ crispOrigin }) => {
  if (crispOrigin) originInput.value = crispOrigin;
  else originInput.value = "http://localhost:3000";
});

goButton.addEventListener("click", async () => {
  const rawOrigin = originInput.value.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//.test(rawOrigin)) {
    status.textContent = "Enter a valid app URL first.";
    return;
  }
  await chrome.storage.local.set({ crispOrigin: rawOrigin });

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url ?? "";
  if (!/^https?:.*\.pdf(\?|#|$)/i.test(url) && !(tab?.title ?? "").toLowerCase().endsWith(".pdf")) {
    status.textContent = "The active tab does not look like a PDF.";
    return;
  }

  goButton.disabled = true;
  status.textContent = "Sending to Crispr…";

  // The app downloads + ingests the PDF server-side, then the chat opens scoped to it.
  try {
    const res = await fetch(`${rawOrigin}/api/documents/fetch-url`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    status.textContent = data.already_ingested ? "Already in library — opening…" : "Ingesting — opening…";
    setTimeout(() => {
      chrome.tabs.create({ url: `${rawOrigin}/?doc=${encodeURIComponent(data.id)}` });
      window.close();
    }, 600);
  } catch (err) {
    status.textContent = err.message || "Failed to reach your Crispr app.";
    goButton.disabled = false;
  }
});
