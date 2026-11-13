-- Hours logged per hour worked during prácticas (e.g. 1.25: 4 h worked = 5 h
-- counted towards the target). 1 = hours counted as worked.
alter table public.settings
  add column practicas_hour_factor numeric(4, 2) not null default 1
    check (practicas_hour_factor between 0.5 and 3);
