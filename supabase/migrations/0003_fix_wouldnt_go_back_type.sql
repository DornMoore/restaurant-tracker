-- PowerSync's local SQLite schema has no boolean type — wouldnt_go_back is
-- stored as a plain 0/1 integer (see src/lib/powersync/schema.ts). PostgREST
-- rejects a raw JSON integer for a `boolean` column outright ("column is of
-- type boolean but expression is of type integer"), which silently jammed
-- the entire upload queue on the first visit ever logged — every record
-- behind it in the queue was blocked too, since PowerSync uploads in order.
--
-- Fix: match the column type to what's actually sent over the wire.
alter table visits
  alter column wouldnt_go_back type smallint using (case when wouldnt_go_back then 1 else 0 end),
  alter column wouldnt_go_back set default 0;
