-- Investigation state for the Wonder investigator (build step: Wonder loop).
-- incidents / incident_trace already exist; this adds the structured state the
-- reasoning view renders: hypotheses with evidence, field tasks dispatched to a
-- person, and a durable checkpoint so an investigation survives worker restarts
-- and long physical pauses (the field worker may take minutes or hours).
-- Access: backend only. RLS enabled, no policies.

create table incident_hypotheses (
  id            uuid primary key default gen_random_uuid(),
  incident_id   text not null references incidents(incident_id) on delete cascade,
  label         text not null,               -- H1, H2, ... as the model names them
  statement     text not null,
  status        text not null default 'open'
                check (status in ('open', 'rejected', 'supported', 'confirmed')),
  evidence_for  jsonb not null default '[]',
  evidence_against jsonb not null default '[]',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (incident_id, label)
);

create table field_tasks (
  id            uuid primary key default gen_random_uuid(),
  incident_id   text not null references incidents(incident_id) on delete cascade,
  kind          text not null check (kind in ('gauge_photo', 'valve_action', 'observation')),
  asset_ids     text[] not null default '{}',
  tags          text[] not null default '{}',   -- instruments to read, e.g. PI-203
  instruction   text not null,                  -- plain-language, bounded task
  status        text not null default 'pending'
                check (status in ('pending', 'completed', 'cancelled')),
  result        jsonb not null default '{}',    -- operator note + submitted readings summary
  consumed      boolean not null default false, -- investigator has resumed on this result
  created_at    timestamptz not null default now(),
  completed_at  timestamptz
);

create table investigation_checkpoints (
  incident_id   text primary key references incidents(incident_id) on delete cascade,
  status        text not null default 'investigating'
                check (status in ('investigating', 'waiting_field', 'concluded', 'escalated')),
  revision      integer not null default 0,     -- bumps on every persisted turn (stale-worker guard)
  steps_used    integer not null default 0,     -- Wonder turns spent (budget enforced in code)
  continuation  jsonb not null default '[]',    -- Responses items incl. encrypted reasoning, replayed intact
  focus         jsonb not null default '{}',    -- {goal, blocker, next_step, focus_assets[]} written by update_focus
  model         text,
  updated_at    timestamptz not null default now()
);

create index incident_hypotheses_incident_idx on incident_hypotheses (incident_id, label);
create index field_tasks_incident_idx on field_tasks (incident_id, status, created_at);

alter table incident_hypotheses     enable row level security;
alter table field_tasks             enable row level security;
alter table investigation_checkpoints enable row level security;
