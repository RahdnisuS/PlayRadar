const LOCALE: Record<string, string> = { INR: "en-IN", USD: "en-US", GBP: "en-GB", EUR: "de-DE" };

export function formatPrice(cents: number, currency: string) {
  return new Intl.NumberFormat(LOCALE[currency] ?? "en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}
