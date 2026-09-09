const TOKEN = process.env.VERCEL_TOKEN;
async function main() {
  const id = process.argv[2];
  const res = await fetch(`https://api.vercel.com/v3/deployments/${id}/events?builds=1`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  const text = await res.text();
  const lines = text.trim().split("\n").filter(Boolean);
  for (const line of lines) {
    try {
      const evt = JSON.parse(line);
      if (evt.type === "stdout" || evt.type === "stderr" || evt.text) {
        console.log(evt.text ?? evt.payload?.text ?? JSON.stringify(evt).slice(0, 200));
      }
    } catch {
      console.log(line.slice(0, 300));
    }
  }
}
main();
