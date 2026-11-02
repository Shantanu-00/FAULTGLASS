-- Telemetry: one row per reading, plus a latest-value table for fast dashboards and tools.
-- The same table also receives completed field readings (provenance = 'field'), so a gauge read
-- from a photo joins the same signal timeline as streamed values. Streamed rows are only ever
-- written by an authenticated edge node; field rows only when a field task completes. Hidden
-- simulator truth never lands here.
--
-- Volume check: 14 signals at 1 Hz is about 1.2 million rows per day, so a single indexed table
-- is enough for the demo. Partition by month and add retention if real plants are connected.

create table edge_nodes (
  edge_node_id      text primary key,
  plant_id          text not null,
  name              text not null,
  api_key_hash      text not null,           -- hash only; the key itself stays on the device
  software_version  text,
  last_seen_at      timestamptz,
  created_at        timestamptz not null default now()
);

create table telemetry (
  ingest_id     bigint generated always as identity,  -- durable cursor for SSE replay
  plant_id      text not null,
  tag           text not null,                         -- instruments.tag, stable across releases
  observed_at   timestamptz not null,                  -- when the device measured it
  received_at   timestamptz not null default now(),    -- when the server stored it
  value         double precision,                      -- engineering units; discrete states as 0 or 1
  raw_value     double precision,                      -- device counts before scaling, when any
  unit          text not null,
  quality       text not null default 'good' check (quality in ('good', 'bad', 'stale', 'uncertain')),
  provenance    text not null check (provenance in ('edge', 'field', 'replay')),
  source_id     text,
  edge_node_id  text references edge_nodes(edge_node_id),
  release_id    uuid references plant_releases(id),
  run_id        uuid,                                  -- sim_runs.id, added as a foreign key later
  primary key (plant_id, tag, observed_at),            -- also makes edge retries idempotent
  unique (ingest_id),
  check (value is not null or quality in ('bad', 'stale'))
);

create index telemetry_received_idx on telemetry (plant_id, received_at);

create table telemetry_latest (
  plant_id     text not null,
  tag          text not null,
  observed_at  timestamptz not null,
  received_at  timestamptz not null,
  value        double precision,
  unit         text not null,
  quality      text not null,
  provenance   text not null,
  ingest_id    bigint not null,
  primary key (plant_id, tag)
);

-- Keep telemetry_latest current; an older reading arriving late never overwrites a newer one.
create function telemetry_latest_upsert() returns trigger language plpgsql as $$
begin
  insert into telemetry_latest as l
    (plant_id, tag, observed_at, received_at, value, unit, quality, provenance, ingest_id)
  values
    (new.plant_id, new.tag, new.observed_at, new.received_at, new.value, new.unit, new.quality,
     new.provenance, new.ingest_id)
  on conflict (plant_id, tag) do update
    set observed_at = excluded.observed_at,
        received_at = excluded.received_at,
        value       = excluded.value,
        unit        = excluded.unit,
        quality     = excluded.quality,
        provenance  = excluded.provenance,
        ingest_id   = excluded.ingest_id
    where l.observed_at < excluded.observed_at;
  return new;
end $$;

create trigger telemetry_latest_trg after insert on telemetry
  for each row execute function telemetry_latest_upsert();

alter table edge_nodes       enable row level security;
alter table telemetry        enable row level security;
alter table telemetry_latest enable row level security;
