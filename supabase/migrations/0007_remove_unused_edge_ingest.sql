-- GitHub Actions now owns asynchronous RAW ingestion. Remove the unused
-- database webhook implementation and its public-schema pg_net extension.
drop function if exists private.enqueue_raw_ingestion();
drop extension if exists pg_net;
