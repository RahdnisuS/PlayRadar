-- PC early-access start, when it is well before games.release_date (IGDB's first_release_date is the full
-- release: Fortnite shows 2020 although it has been playable since 2017).
ALTER TABLE games ADD COLUMN early_access_date DATE;
