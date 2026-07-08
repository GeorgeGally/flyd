export interface GistSaveResult {
  url: string | null;
  id: string | null;
}

export async function saveToGist(
  token: string,
  content: string,
  description: string,
): Promise<GistSaveResult> {
  const body = {
    description,
    public: false,
    files: {
      [`${description.replace(/[^a-zA-Z0-9]/g, "-").slice(0, 60)}.md`]: { content },
    },
  };

  try {
    const resp = await fetch("https://api.github.com/gists", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!resp.ok) return { url: null, id: null };
    const data = (await resp.json()) as any;
    return { url: data.html_url ?? null, id: data.id ?? null };
  } catch {
    return { url: null, id: null };
  }
}

export async function fetchRecentGists(
  token: string,
  since?: string,
  perPage = 5,
): Promise<Array<{ id: string; url: string; description: string; created_at: string; content: string }>> {
  const params = new URLSearchParams({ per_page: String(perPage), sort: "created", direction: "desc" });
  if (since) params.set("since", since);

  try {
    const listResp = await fetch(`https://api.github.com/gists?${params}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
      },
    });
    if (!listResp.ok) return [];
    const gists = (await listResp.json()) as any[];
    if (!gists.length) return [];

    const results: Array<{ id: string; url: string; description: string; created_at: string; content: string }> = [];
    for (const gist of gists) {
      const file = Object.values(gist.files ?? {})[0] as any;
      if (!file) continue;
      if (file.truncated) {
        const rawResp = await fetch(file.raw_url);
        if (rawResp.ok) file.content = await rawResp.text();
      }
      results.push({
        id: gist.id,
        url: gist.html_url ?? "",
        description: gist.description ?? "",
        created_at: gist.created_at ?? "",
        content: file.content ?? "",
      });
    }
    return results;
  } catch {
    return [];
  }
}
