-- Price history is backfilled from the provider lazily (first Buy popup / wishlist), not for the whole catalog.
ALTER TABLE price_summary ADD COLUMN history_backfilled_at TIMESTAMPTZ;
