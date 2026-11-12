export type Gift = {
  id: string;
  title: string;
  externalUrl: string | null;
  amount: string | null;
  currency: "RUB" | "EUR" | "USD" | null;
  comment: string | null;
  imageUrl: string | null;
  reserved: boolean;
  version: number;
  imageAssetId?: string | null;
  reserverDisplayName?: string | null;
};
export type Wishlist = {
  event: { title: string };
  gifts: Gift[];
  total: number;
  reservedTotal: number;
  nextCursor: string | null;
  revision: string;
  hideReserverIdentity?: boolean;
  version?: number;
};
export function giftPrice(gift: Pick<Gift, "amount" | "currency">) {
  if (gift.amount == null || !gift.currency) return null;
  const [integer, fraction = "00"] = gift.amount.split(".");
  return `${integer.replace(/\B(?=(\d{3})+(?!\d))/g, " ")},${fraction.padEnd(2, "0")} ${{ RUB: "₽", EUR: "€", USD: "$" }[gift.currency]}`;
}
