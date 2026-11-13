-- Event titles hidden in Huecos for a calendar (e.g. "Día libre", "Vacaciones"):
-- matching events are neither shown nor counted as busy. Compared trimmed and
-- case-insensitively by the app; the feed itself is untouched.
alter table public.calendars
  add column hidden_titles text[] not null default '{}'
    check (cardinality(hidden_titles) <= 100 and char_length(array_to_string(hidden_titles, '')) <= 10000);

grant update (hidden_titles) on public.calendars to authenticated;
