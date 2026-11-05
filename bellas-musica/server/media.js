// Photo validation (by file signature, not by what the client claims) and video link parsing.
export function sniffImage(buf) {
  if (buf.length > 12 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: "jpg", mime: "image/jpeg" };
  if (buf.length > 12 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: "png", mime: "image/png" };
  if (buf.length > 12 && buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") return { ext: "webp", mime: "image/webp" };
  return null;
}

export const MIME_BY_EXT = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" };

// Accept only YouTube and Vimeo links; store just the provider and id so we control the embed URL.
export function parseVideo(input) {
  const raw = String(input || "").trim();
  if (!raw) return { provider: "", id: "" };
  let u;
  try { u = new URL(/^https?:\/\//i.test(raw) ? raw : "https://" + raw); } catch { return null; }
  const host = u.hostname.replace(/^www\.|^m\./, "");
  let id = "";
  if (host === "youtu.be") id = u.pathname.split("/")[1] || "";
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    const seg = u.pathname.split("/").filter(Boolean);
    if (u.pathname === "/watch") id = u.searchParams.get("v") || "";
    else if (["shorts", "embed", "live"].includes(seg[0])) id = seg[1] || "";
    if (/^[\w-]{11}$/.test(id)) return { provider: "youtube", id };
    return null;
  } else if (host === "vimeo.com" || host === "player.vimeo.com") {
    id = u.pathname.split("/").filter(Boolean).pop() || "";
    if (/^\d{5,12}$/.test(id)) return { provider: "vimeo", id };
    return null;
  } else if (host === "tiktok.com") { // https://www.tiktok.com/@name/video/7312345678901234567
    const seg = u.pathname.split("/").filter(Boolean);
    if (seg.length >= 3 && seg[0].startsWith("@") && seg[1] === "video" && /^\d{15,22}$/.test(seg[2])) return { provider: "tiktok", id: seg[2] };
    return null; // short links (vm.tiktok.com) can't be resolved safely, so ask for the full video link
  } else if (host === "instagram.com") { // https://www.instagram.com/reel/CODE/ (also /reels/CODE, /p/CODE, /tv/CODE)
    const seg = u.pathname.split("/").filter(Boolean);
    const kind = seg[0] === "reels" || seg[0] === "reel" || seg[0] === "tv" ? "reel" : seg[0] === "p" ? "p" : "";
    if (kind && /^[\w-]{5,20}$/.test(seg[1] || "")) return { provider: "instagram", id: `${kind}:${seg[1]}` };
    return null;
  }
  if (host === "youtu.be" && /^[\w-]{11}$/.test(id)) return { provider: "youtube", id };
  return null;
}

// A venue's virtual tour (a 360° walk-through): Matterport, Kuula, or a YouTube/Vimeo video (360° videos play in
// the same player). Only these hosts are accepted, and the page embeds only the ids, never the link as typed.
export function parseTour(input) {
  const raw = String(input || "").trim();
  if (!raw) return { provider: "", id: "" };
  let u;
  try { u = new URL(/^https?:\/\//i.test(raw) ? raw : "https://" + raw); } catch { return null; }
  const host = u.hostname.replace(/^www\./, "");
  if (host === "my.matterport.com" || host === "matterport.com") { // https://my.matterport.com/show/?m=SxQL3iGyoDo
    const id = u.searchParams.get("m") || "";
    return /^\/show\/?$/.test(u.pathname) && /^[A-Za-z0-9]{11}$/.test(id) ? { provider: "matterport", id } : null;
  }
  if (host === "kuula.co") { // https://kuula.co/share/7lVbT, /share/collection/7lVbT, /post/7lVbT
    const seg = u.pathname.split("/").filter(Boolean);
    if (seg[0] === "share" && seg[1] === "collection" && /^[\w-]{4,16}$/.test(seg[2] || "")) return { provider: "kuula", id: "c:" + seg[2] };
    if ((seg[0] === "share" || seg[0] === "post") && /^[\w-]{4,16}$/.test(seg[1] || "") && seg[1] !== "collection") return { provider: "kuula", id: seg[1] };
    return null;
  }
  const v = parseVideo(raw);
  return v && (v.provider === "youtube" || v.provider === "vimeo") ? v : null;
}

export function tourEmbedUrl(provider, id) {
  if (provider === "matterport" && /^[A-Za-z0-9]{11}$/.test(id)) return `https://my.matterport.com/show/?m=${id}`;
  if (provider === "kuula") { const m = /^(c:)?([\w-]{4,16})$/.exec(id); if (m) return `https://kuula.co/share/${m[1] ? "collection/" : ""}${m[2]}`; }
  if (provider === "youtube" || provider === "vimeo") return embedUrl(provider, id);
  return "";
}

export function embedUrl(provider, id) {
  if (provider === "youtube") return `https://www.youtube-nocookie.com/embed/${id}`;
  if (provider === "vimeo") return `https://player.vimeo.com/video/${id}`;
  if (provider === "tiktok" && /^\d{15,22}$/.test(id)) return `https://www.tiktok.com/embed/v2/${id}`;
  if (provider === "instagram") { const m = /^(reel|p):([\w-]{5,20})$/.exec(id); if (m) return `https://www.instagram.com/${m[1]}/${m[2]}/embed`; }
  return "";
}
