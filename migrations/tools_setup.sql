-- Create user_tools table
create table if not exists public.user_tools (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) not null,
  upi_id text not null,
  phone_number text, -- efficient to store extracted phone if needed
  status text default 'running', -- running, stopped, error
  platform text default 'upi', -- mobikwik, phonepe, etc. (optional, inferred from upi)
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable RLS
alter table public.user_tools enable row level security;

-- Policies
create policy "Users can view own tools" on user_tools for select using (auth.uid() = user_id);
create policy "Users can insert own tools" on user_tools for insert with check (auth.uid() = user_id);
create policy "Users can update own tools" on user_tools for update using (auth.uid() = user_id);
create policy "Users can delete own tools" on user_tools for delete using (auth.uid() = user_id);
