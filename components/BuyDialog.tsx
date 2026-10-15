"use client";

import { Modal } from "./Modal";
import { PricePanel } from "./PricePanel";
import type { ShopCode } from "@/lib/prices/provider";

/** The "Buy now" popup: just the Steam vs Epic price comparison. Mount it only while open. */
export function BuyDialog({
  gameId,
  title,
  onClose,
  onStoreClick,
}: {
  gameId: string;
  title: string;
  onClose: () => void;
  onStoreClick?: (shop: ShopCode) => void;
}) {
  return (
    <Modal title={`Where to buy ${title}`} onClose={onClose}>
      <PricePanel gameId={gameId} onStoreClick={onStoreClick} />
    </Modal>
  );
}
