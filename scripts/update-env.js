// Atualiza uma variável de ambiente existente no projeto Vercel.
// Uso: VERCEL_TOKEN="..." node scripts/update-env.js NOME_DA_VAR "novo valor"
const TOKEN = process.env.VERCEL_TOKEN;
const PROJECT_ID = "prj_kQXp2ZubebjLVKxGxfaLuuJVSug5";

async function api(pathname, opts = {}) {
  const res = await fetch(`https://api.vercel.com${pathname}`, {
    ...opts,
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json", ...(opts.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${pathname} -> ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

async function main() {
  const key = process.argv[2];
  const value = process.argv[3];
  const { envs } = await api(`/v9/projects/${PROJECT_ID}/env`);
  const existing = envs.find((e) => e.key === key);
  if (existing) {
    await api(`/v9/projects/${PROJECT_ID}/env/${existing.id}`, {
      method: "PATCH",
      body: JSON.stringify({ value, target: ["production", "preview", "development"] }),
    });
    console.log("atualizado:", key);
  } else {
    await api(`/v10/projects/${PROJECT_ID}/env`, {
      method: "POST",
      body: JSON.stringify({ key, value, type: "encrypted", target: ["production", "preview", "development"] }),
    });
    console.log("criado:", key);
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
