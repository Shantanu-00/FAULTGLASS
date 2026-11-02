-- Valve approval, voice observations, and verified closure.
-- Wonder proposes a plant-changing action, a commander approves it, the field
-- submits staged lever evidence, and only then may code trigger the simulator
-- and ask the deterministic verifier to close the incident.
-- Access: backend only. RLS enabled, no policies.

alter table investigation_checkpoints
  drop constraint if exists investigation_checkpoints_status_check;

alter table investigation_checkpoints
  add constraint investigation_checkpoints_status_check
  check (status in ('investigating', 'waiting_field', 'awaiting_approval', 'concluded', 'escalated'));

create table action_proposals (
  id            uuid primary key default gen_random_uuid(),
  incident_id   text not null references incidents(incident_id) on delete cascade,
  asset_id      text not null,
  action        text not null check (action in ('backwash')),
  rationale     text not null,
  sop_id        text,
  status        text not null default 'pending'
                check (status in ('pending', 'approved', 'rejected', 'executed', 'failed')),
  field_task_id uuid references field_tasks(id) on delete set null,
  result        jsonb not null default '{}',
  created_at    timestamptz not null default now(),
  approved_at   timestamptz,
  executed_at   timestamptz
);

create table voice_observations (
  id            uuid primary key default gen_random_uuid(),
  incident_id   text not null references incidents(incident_id) on delete cascade,
  task_id       uuid references field_tasks(id) on delete set null,
  transcript    text not null,
  language_bias text[] not null default '{}',
  structured    jsonb not null default '{}',
  comparison    jsonb not null default '{}',
  audio_sha256  text not null,
  audio_path    text not null,
  model         text not null,
  created_at    timestamptz not null default now()
);

create index action_proposals_incident_status_idx
  on action_proposals (incident_id, status, created_at);
create index action_proposals_executed_idx
  on action_proposals (executed_at) where status = 'executed';
create index voice_observations_incident_idx
  on voice_observations (incident_id, created_at);
create index voice_observations_task_idx
  on voice_observations (task_id, created_at);

alter table action_proposals enable row level security;
alter table voice_observations enable row level security;
