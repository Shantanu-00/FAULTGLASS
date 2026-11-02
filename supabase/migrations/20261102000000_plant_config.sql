-- Plant configuration and topology.
-- A "release" is an immutable snapshot of a plant pack (plants/<id>/). Every child row carries
-- release_id; publishing a changed pack creates a new release rather than editing an old one.
-- Access: backend only (service role or direct connection). RLS is enabled with no policies,
-- so the anon and authenticated roles can read nothing; the browser goes through the API.

create table plant_releases (
  id            uuid primary key default gen_random_uuid(),
  plant_id      text not null,
  version       text not null,
  content_hash  text not null,
  data_origin   text not null check (data_origin in ('synthetic', 'surveyed')),
  facility_id   text not null,
  manifest      jsonb not null,
  layout        jsonb,                    -- floor polygon and asset placements, metres
  published_at  timestamptz not null default now(),
  unique (plant_id, content_hash)
);

create table plant_assets (
  release_id      uuid not null references plant_releases(id) on delete cascade,
  asset_id        text not null,
  name            text not null,
  kind            text not null,
  section         text not null,            -- key into manifest.sections
  plan_item       text,
  basis           text not null default 'assumed'
    check (basis in ('footage', 'description', 'standard_practice', 'assumed')),
  role            text not null check (role in ('source', 'sink', 'process', 'group', 'support')),
  control         text not null check (control in ('manual', 'motorized', 'automatic', 'none')),
  parent_asset_id text,
  scene_node      text,
  normal_state    jsonb,
  spec            jsonb not null default '{}',
  primary key (release_id, asset_id),
  foreign key (release_id, parent_asset_id) references plant_assets(release_id, asset_id)
    deferrable initially deferred
);

create table plant_ports (
  release_id  uuid not null,
  asset_id    text not null,
  port_id     text not null,
  direction   text not null check (direction in ('in', 'out')),
  primary key (release_id, asset_id, port_id),
  foreign key (release_id, asset_id) references plant_assets(release_id, asset_id) on delete cascade
);

-- Directed pipe. A port connects to at most one pipe, so tees expose one port per connection.
create table plant_edges (
  release_id     uuid not null,
  edge_id        text not null,
  from_asset_id  text not null,
  from_port_id   text not null,
  to_asset_id    text not null,
  to_port_id     text not null,
  medium         text not null
    check (medium in ('raw', 'pretreated', 'chemical', 'highpressure', 'permeate', 'reject', 'pure',
                      'backwash', 'drain', 'oxygen', 'ozone_gas')),
  basis          text not null default 'assumed'
    check (basis in ('footage', 'description', 'standard_practice', 'assumed')),
  primary key (release_id, edge_id),
  foreign key (release_id, from_asset_id, from_port_id)
    references plant_ports(release_id, asset_id, port_id) on delete cascade,
  foreign key (release_id, to_asset_id, to_port_id)
    references plant_ports(release_id, asset_id, port_id) on delete cascade,
  unique (release_id, from_asset_id, from_port_id),
  unique (release_id, to_asset_id, to_port_id)
);

-- Named alternative paths the investigation may propose; `requires` lists manual valve states.
create table plant_routes (
  release_id     uuid not null references plant_releases(id) on delete cascade,
  route_id       text not null,
  name           text not null,
  kind           text not null
    check (kind in ('duty', 'standby', 'bypass', 'service', 'backwash', 'rinse')),
  from_asset_id  text not null,
  to_asset_id    text not null,
  edge_ids       text[] not null,
  requires       jsonb not null,
  primary key (release_id, route_id)
);

-- Where readings come from. endpoint never holds secrets; credential_ref names a secret held
-- on the edge node.
create table data_sources (
  release_id       uuid not null references plant_releases(id) on delete cascade,
  source_id        text not null,
  name             text not null,
  protocol         text not null check (protocol in ('modbus_tcp', 'opcua', 'mqtt', 'manual')),
  edge_node_id     text,
  poll_interval_s  double precision,
  endpoint         jsonb not null default '{}',
  credential_ref   text,
  note             text,
  primary key (release_id, source_id)
);

-- observe = 'telemetry': streamed by an edge node from source_id at `address`.
-- observe = 'field_photo': no API; a person reads it on site (value arrives via a field task).
create table instruments (
  release_id     uuid not null references plant_releases(id) on delete cascade,
  tag            text not null,
  name           text not null,
  type           text not null check (type in ('measurement', 'switch', 'status')),
  quantity       text not null,
  unit           text not null,
  range_min      double precision not null,
  range_max      double precision not null,
  attach_kind    text not null check (attach_kind in ('asset', 'port', 'edge', 'span')),
  attach_refs    text[] not null,
  observe        text not null check (observe in ('telemetry', 'field_photo')),
  basis          text not null default 'assumed'
    check (basis in ('footage', 'description', 'standard_practice', 'assumed')),
  display_scales jsonb,                    -- printed scales on an analog dial, e.g. kg/cm2 and psi
  source_id      text,
  address        jsonb,
  scaling        jsonb,
  freshness_s    double precision,
  limits         jsonb,
  setpoint       jsonb,
  state_labels   jsonb,
  location_note  text,
  note           text,
  primary key (release_id, tag),
  foreign key (release_id, source_id) references data_sources(release_id, source_id),
  check (range_min < range_max),
  check (observe <> 'telemetry' or (source_id is not null and address is not null and freshness_s is not null)),
  check (observe <> 'field_photo' or (source_id is null and location_note is not null))
);

-- Releases are immutable: rows may be inserted or cascade-deleted with their release, never edited.
create function forbid_update() returns trigger language plpgsql as $$
begin
  raise exception 'plant release data is immutable; publish a new release instead';
end $$;

create trigger plant_releases_immutable before update on plant_releases
  for each row execute function forbid_update();
create trigger plant_assets_immutable before update on plant_assets
  for each row execute function forbid_update();
create trigger plant_ports_immutable before update on plant_ports
  for each row execute function forbid_update();
create trigger plant_edges_immutable before update on plant_edges
  for each row execute function forbid_update();
create trigger plant_routes_immutable before update on plant_routes
  for each row execute function forbid_update();
create trigger data_sources_immutable before update on data_sources
  for each row execute function forbid_update();
create trigger instruments_immutable before update on instruments
  for each row execute function forbid_update();

alter table plant_releases enable row level security;
alter table plant_assets   enable row level security;
alter table plant_ports    enable row level security;
alter table plant_edges    enable row level security;
alter table plant_routes   enable row level security;
alter table data_sources   enable row level security;
alter table instruments    enable row level security;

create index plant_edges_to_idx on plant_edges (release_id, to_asset_id);
create index instruments_observe_idx on instruments (release_id, observe);
