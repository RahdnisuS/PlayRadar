// Alert / digest email. The actual price is the point, so it leads the subject line and every item.
// Footer: site name, why you got it, manage + one-click unsubscribe. Never a postal address.
import { formatPrice } from "../format";
import { REGIONS } from "../regions";

export type AlertKind = "sale" | "all_time_low" | "target_hit" | "released";

export type EmailItem = {
  title: string;
  coverUrl: string | null;
  kinds: AlertKind[];
  releaseStatus: string;
  storeName: string | null;
  storeUrl: string | null;
  priceCents: number | null;
  regularCents: number | null;
  currency: string | null;
  saleEndsAt: Date | null;
  targetCents: number | null;
  targetCurrency: string | null;
};

export type EmailContext = { siteUrl: string; unsubscribeUrl: string; country: string; digest: "instant" | "daily" | "weekly" };

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function price(i: EmailItem): string | null {
  if (i.priceCents == null || !i.currency) return null;
  return i.priceCents === 0 ? "Free" : formatPrice(i.priceCents, i.currency);
}

function discount(i: EmailItem): number {
  return i.priceCents != null && i.regularCents ? Math.round(((i.regularCents - i.priceCents) / i.regularCents) * 100) : 0;
}

function releasedText(i: EmailItem) {
  return i.releaseStatus === "early_access" ? "is out now in early access" : "is out now";
}

/** One-line headline for an item, e.g. "Hades: ₹550 on Steam (-50%), all-time low". */
function headline(i: EmailItem): string {
  const p = price(i);
  const where = p ? `${p}${i.storeName ? ` on ${i.storeName}` : ""}` : null;
  if (i.kinds.includes("released") && i.kinds.length === 1) return `${i.title} ${releasedText(i)}${where ? `: ${where}` : ""}`;
  const d = discount(i);
  const notes = [
    i.kinds.includes("all_time_low") ? "all-time low" : null,
    i.kinds.includes("target_hit") ? "below your target" : null,
  ].filter(Boolean);
  return `${i.title}: ${where ?? "price changed"}${d > 0 ? ` (-${d}%)` : ""}${notes.length ? `, ${notes.join(", ")}` : ""}`;
}

export function subject(items: EmailItem[], digest: EmailContext["digest"]): string {
  if (items.length === 1) return headline(items[0]);
  const shown = items.slice(0, 2).map((i) => `${i.title} ${price(i) ?? ""}`.trim());
  const more = items.length > 2 ? ` + ${items.length - 2} more` : "";
  const prefix = digest === "daily" ? "Today on your wishlist" : digest === "weekly" ? "This week on your wishlist" : "Wishlist alerts";
  return `${prefix}: ${shown.join(", ")}${more}`;
}

function badges(i: EmailItem): string[] {
  const d = discount(i);
  return [
    i.kinds.includes("released") ? (i.releaseStatus === "early_access" ? "Early access now" : "Out now") : null,
    d > 0 ? `-${d}%` : null,
    i.kinds.includes("all_time_low") ? "All-time low" : null,
    i.kinds.includes("target_hit") && i.targetCents != null && i.targetCurrency
      ? `Below your ${formatPrice(i.targetCents, i.targetCurrency)} target`
      : null,
  ].filter((b): b is string => !!b);
}

const dateFmt = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

function itemHtml(i: EmailItem): string {
  const p = price(i);
  const d = discount(i);
  const cover = i.coverUrl
    ? `<img src="${esc(i.coverUrl)}" width="60" height="80" alt="" style="display:block;border-radius:4px;object-fit:cover">`
    : "";
  const priceLine = p
    ? `<span style="font-size:20px;font-weight:700;color:#0b0d12">${esc(p)}</span>` +
      (d > 0 && i.regularCents && i.currency
        ? ` <span style="color:#6b7280;text-decoration:line-through">${esc(formatPrice(i.regularCents, i.currency))}</span>`
        : "") +
      (i.storeName ? ` <span style="color:#374151">on ${esc(i.storeName)}</span>` : "")
    : `<span style="color:#6b7280">No price in your region yet</span>`;
  const ends = i.saleEndsAt ? `<div style="color:#6b7280;font-size:12px;margin-top:2px">Sale ends ${esc(dateFmt(i.saleEndsAt))}</div>` : "";
  const tagHtml = badges(i)
    .map((b) => `<span style="display:inline-block;background:#dcfce7;color:#166534;border-radius:4px;padding:1px 6px;margin:0 4px 4px 0;font-size:12px">${esc(b)}</span>`)
    .join("");
  const button = i.storeUrl
    ? `<a href="${esc(i.storeUrl)}" style="display:inline-block;margin-top:8px;background:#0f766e;color:#ffffff;text-decoration:none;border-radius:6px;padding:6px 12px;font-size:13px">View on ${esc(i.storeName ?? "the store")}</a>`
    : "";
  return `<tr><td style="padding:12px 0;border-bottom:1px solid #e5e7eb">
  <table role="presentation" cellpadding="0" cellspacing="0"><tr>
    <td valign="top" style="padding-right:12px">${cover}</td>
    <td valign="top">
      <div style="font-size:15px;font-weight:600;color:#0b0d12;margin-bottom:4px">${esc(i.title)}</div>
      <div>${tagHtml}</div>
      <div>${priceLine}</div>${ends}
      ${button}
    </td>
  </tr></table>
</td></tr>`;
}

function itemText(i: EmailItem): string {
  const lines = [headline(i)];
  if (i.saleEndsAt) lines.push(`  Sale ends ${dateFmt(i.saleEndsAt)}`);
  if (i.storeUrl) lines.push(`  ${i.storeUrl}`);
  return lines.join("\n");
}

export function renderEmail(items: EmailItem[], ctx: EmailContext): { subject: string; html: string; text: string } {
  const region = REGIONS.find((r) => r.code === ctx.country)?.label ?? ctx.country;
  const manage = `${ctx.siteUrl}/wishlist`;
  const intro =
    items.length === 1
      ? "A game on your PlayRadar wishlist has news:"
      : `${items.length} games on your PlayRadar wishlist have news:`;
  const footer = `You're getting this because you wishlisted these games on PlayRadar and asked for email alerts. Prices are for ${region} and can change at any time, so check the store before you buy. PlayRadar doesn't sell games and isn't affiliated with Steam or Epic.`;

  const html = `<!doctype html><html><body style="margin:0;background:#f3f4f6;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:10px;padding:20px 24px">
  <tr><td style="font-size:18px;font-weight:700;color:#0b0d12;padding-bottom:4px">Play<span style="color:#0f766e">Radar</span></td></tr>
  <tr><td style="font-size:14px;color:#374151;padding-bottom:4px">${esc(intro)}</td></tr>
  ${items.map(itemHtml).join("\n")}
  <tr><td style="padding-top:16px;font-size:12px;line-height:18px;color:#6b7280">
    ${esc(footer)}<br><br>
    <a href="${esc(manage)}" style="color:#0f766e">Manage your wishlist and email settings</a> ·
    <a href="${esc(ctx.unsubscribeUrl)}" style="color:#0f766e">Unsubscribe from all PlayRadar emails</a>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;

  const text = [
    "PlayRadar",
    "",
    intro,
    "",
    ...items.map(itemText).flatMap((t) => [t, ""]),
    footer,
    "",
    `Manage your wishlist and email settings: ${manage}`,
    `Unsubscribe from all PlayRadar emails: ${ctx.unsubscribeUrl}`,
  ].join("\n");

  return { subject: subject(items, ctx.digest), html, text };
}
