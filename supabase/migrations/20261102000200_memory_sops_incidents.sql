-- Grounding memory, SOPs and incident history.
-- plant_memory : text blocks injected into the AI's context when an incident opens
--                (topology, observability, human-in-the-loop list). Generated from the plant pack.
-- sops         : standard operating procedures. SYNTHETIC: the site has none; we wrote them.
-- incidents    : past (and live) incidents. Past ones are seeded with data_origin = 'synthetic'.
-- incident_trace: ordered log of what the model did on an incident (tool calls, hypotheses
--                created / rejected / confirmed, evidence, outcome). One row per step.
-- Access: backend only. RLS enabled, no policies.

create table plant_memory (
  id          uuid primary key default gen_random_uuid(),
  plant_id    text not null,
  kind        text not null check (kind in ('topology', 'observability', 'human_tasks', 'floor_plan', 'glossary')),
  title       text not null,
  body_md     text not null,
  data_origin text not null default 'surveyed' check (data_origin in ('synthetic', 'surveyed')),
  created_at  timestamptz not null default now(),
  unique (plant_id, kind)
);

create table sops (
  sop_id         text primary key,             -- e.g. SOP-RO-003
  title          text not null,
  version        text not null default '1.0',
  applies_to     text[] not null default '{}', -- asset ids
  triggers       text[] not null default '{}', -- alarm / symptom keywords
  requires_human boolean not null default true,
  steps          jsonb not null,               -- [{n, action, actor, asset, expect, caution}]
  body_md        text not null,
  data_origin    text not null default 'synthetic' check (data_origin in ('synthetic', 'surveyed')),
  created_at     timestamptz not null default now()
);

create table incidents (
  incident_id   text primary key,              -- e.g. INC-2026-0412
  plant_id      text not null,
  title         text not null,
  status        text not null check (status in ('open', 'resolved', 'closed')),
  severity      text not null check (severity in ('low', 'medium', 'high')),
  opened_at     timestamptz not null,
  closed_at     timestamptz,
  symptoms      jsonb not null default '[]',   -- alarms and observations at open
  root_cause    text,
  resolution    text,
  sops_used     text[] not null default '{}',
  closed_by     text check (closed_by in ('verifier', 'operator')),
  lessons       text,
  data_origin   text not null default 'synthetic' check (data_origin in ('synthetic', 'live')),
  models_used   text[] not null default '{}'
);

create table incident_trace (
  incident_id text not null references incidents(incident_id) on delete cascade,
  seq         integer not null,
  at          timestamptz not null,
  kind        text not null check (kind in (
    'alarm', 'recall', 'hypothesis', 'tool_call', 'tool_result', 'observation',
    'hypothesis_rejected', 'hypothesis_confirmed', 'human_task', 'human_result',
    'action', 'verification', 'note')),
  actor       text not null check (actor in ('system', 'model', 'operator', 'verifier', 'code')),
  hypothesis_id text,                          -- H1, H2 ... groups steps about one hypothesis
  tool_name   text,
  tool_args   jsonb,
  content     text not null,                   -- the model's own words or the tool result summary
  evidence    jsonb not null default '[]',     -- tags, document ids, prior incident ids cited
  primary key (incident_id, seq)
);

create index incidents_plant_idx on incidents (plant_id, opened_at desc);
create index incident_trace_hyp_idx on incident_trace (incident_id, hypothesis_id);

alter table plant_memory   enable row level security;
alter table sops           enable row level security;
alter table incidents      enable row level security;
alter table incident_trace enable row level security;
