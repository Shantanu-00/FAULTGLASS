create table sim_runs (
  id                  uuid primary key default gen_random_uuid(),
  plant_id            text not null,
  status              text not null default 'starting'
                      check (status in ('starting', 'learning', 'running', 'stopped')),
  seed                bigint not null,
  clock_speed         double precision not null default 1 check (clock_speed > 0),
  scenario            text,
  scenario_started_at timestamptz,
  started_at          timestamptz not null default now(),
  baseline_ready_at   timestamptz,
  last_heartbeat_at   timestamptz not null default now(),
  stopped_at          timestamptz,
  stop_reason         text check (stop_reason in ('requested', 'heartbeat_lost', 'replaced')),
  check ((status = 'stopped') = (stopped_at is not null))
);

create unique index sim_runs_one_active on sim_runs (plant_id) where status <> 'stopped';
create index sim_runs_plant_started_idx on sim_runs (plant_id, started_at desc);

create table sim_events (
  id      bigint generated always as identity primary key,
  run_id  uuid not null references sim_runs(id) on delete cascade,
  at      timestamptz not null default now(),
  kind    text not null check (kind in ('scenario', 'valve_action')),
  payload jsonb not null default '{}'
);

create index sim_events_run_idx on sim_events (run_id, id);

alter table telemetry add constraint telemetry_run_fk foreign key (run_id) references sim_runs(id);
create index telemetry_run_idx on telemetry (run_id, observed_at) where run_id is not null;

create table signal_flags (
  id               uuid primary key default gen_random_uuid(),
  plant_id         text not null,
  run_id           uuid references sim_runs(id) on delete set null,
  raised_at        timestamptz not null default now(),
  status           text not null default 'open'
                   check (status in ('open', 'picked_up', 'dismissed', 'resolved')),
  severity         text not null check (severity in ('info', 'warning', 'critical')),
  tags             text[] not null check (cardinality(tags) > 0),
  summary          text not null,
  evidence         jsonb not null default '{}',
  model            text,
  model_latency_ms integer check (model_latency_ms >= 0),
  incident_id      text
);

create index signal_flags_open_idx on signal_flags (plant_id, raised_at desc) where status = 'open';
create index signal_flags_run_idx on signal_flags (run_id, raised_at);

alter table sim_runs     enable row level security;
alter table sim_events   enable row level security;
alter table signal_flags enable row level security;
