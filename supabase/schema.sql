-- Saligue database schema for Supabase. Run this in the Supabase SQL editor.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  role text not null default 'buyer' check (role in ('buyer', 'seller')),
  official boolean not null default false,
  shop jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare requested_role text;
begin
  requested_role := new.raw_user_meta_data ->> 'role';
  if requested_role is null or requested_role not in ('buyer', 'seller') then requested_role := 'buyer'; end if;
  insert into public.profiles(id, email, display_name, role)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'display_name', new.raw_user_meta_data ->> 'full_name'), requested_role)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute procedure public.handle_new_user();

create or replace function public.protect_profile_official()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.official is distinct from old.official and auth.uid() is not null then
    raise exception 'Only a trusted administrator can change the official flag';
  end if;
  return new;
end;
$$;
drop trigger if exists protect_profile_official on public.profiles;
create trigger protect_profile_official before update on public.profiles
for each row execute procedure public.protect_profile_official();

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  price numeric(12,2) not null check (price >= 0),
  image text not null,
  cutout text,
  embedding jsonb,
  category text not null,
  seller text not null,
  seller_id uuid not null references auth.users(id) on delete cascade,
  seller_email text,
  status text not null default 'active' check (status in ('active', 'archived', 'draft')),
  description text,
  size text,
  color text,
  brand text,
  condition text,
  contact text,
  created_at timestamptz not null default now(),
  shop jsonb,
  official boolean not null default false,
  like_count integer not null default 0 check (like_count >= 0),
  sound jsonb
);
create index if not exists products_created_at_idx on public.products(created_at desc);
create index if not exists products_seller_id_idx on public.products(seller_id);

create or replace function public.protect_product_owner_fields()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      if new.seller_id <> auth.uid() then raise exception 'seller_id must match the signed-in user'; end if;
      new.official := coalesce((select p.official from public.profiles p where p.id = auth.uid()), false);
    end if;
  else
    if new.seller_id is distinct from old.seller_id then raise exception 'seller_id cannot be changed'; end if;
    if new.official is distinct from old.official and auth.uid() is not null then raise exception 'official cannot be changed'; end if;
    if new.like_count is distinct from old.like_count and current_setting('saligue.adjust_like_count', true) is distinct from 'on' then
      raise exception 'like_count is maintained by product likes';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists protect_product_owner_fields on public.products;
create trigger protect_product_owner_fields before insert or update on public.products
for each row execute procedure public.protect_product_owner_fields();

create table if not exists public.product_likes (
  product_id uuid not null references public.products(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (product_id, user_id)
);

create or replace function public.adjust_product_like_count()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    perform set_config('saligue.adjust_like_count', 'on', true);
    update public.products set like_count = like_count + 1 where id = new.product_id;
    perform set_config('saligue.adjust_like_count', 'off', true);
    return new;
  end if;
  perform set_config('saligue.adjust_like_count', 'on', true);
  update public.products set like_count = greatest(0, like_count - 1) where id = old.product_id;
  perform set_config('saligue.adjust_like_count', 'off', true);
  return old;
end;
$$;
drop trigger if exists adjust_product_like_count on public.product_likes;
create trigger adjust_product_like_count after insert or delete on public.product_likes
for each row execute procedure public.adjust_product_like_count();

create table if not exists public.product_comments (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) <= 60),
  text text not null check (char_length(text) between 1 and 500),
  created_at timestamptz not null default now()
);
create index if not exists product_comments_product_created_idx on public.product_comments(product_id, created_at desc);

create table if not exists public.cart_items (
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  quantity integer not null check (quantity between 1 and 99),
  primary key (user_id, product_id)
);

create table if not exists public.wishlists (
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (user_id, product_id)
);

create table if not exists public.product_audio (
  product_id uuid primary key references public.products(id) on delete cascade,
  seller_id uuid not null references auth.users(id) on delete cascade,
  data text not null,
  name text not null check (char_length(name) <= 80),
  duration numeric not null check (duration > 0 and duration <= 30)
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references auth.users(id),
  buyer_name text not null,
  buyer_email text not null default '',
  seller_id uuid not null references auth.users(id),
  shop jsonb,
  items jsonb not null,
  total numeric(12,2) not null check (total >= 0),
  delivery jsonb not null,
  payment_method text not null check (payment_method in ('mobile_money', 'cash_on_delivery', 'pickup')),
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid', 'paid')),
  status text not null default 'placed' check (status in ('placed', 'confirmed', 'shipped', 'delivered', 'cancelled')),
  created_at timestamptz not null default now()
);
create index if not exists orders_buyer_created_idx on public.orders(buyer_id, created_at desc);
create index if not exists orders_seller_created_idx on public.orders(seller_id, created_at desc);

create or replace function public.protect_order_changes()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.buyer_id is distinct from old.buyer_id or new.seller_id is distinct from old.seller_id
    or new.buyer_name is distinct from old.buyer_name or new.buyer_email is distinct from old.buyer_email
    or new.shop is distinct from old.shop or new.created_at is distinct from old.created_at
    or new.items is distinct from old.items or new.total is distinct from old.total
    or new.delivery is distinct from old.delivery or new.payment_method is distinct from old.payment_method then
    raise exception 'Order details cannot be changed after placement';
  end if;
  if auth.uid() = old.buyer_id then
    if old.status <> 'placed' or new.status <> 'cancelled' or new.payment_status is distinct from old.payment_status then
      raise exception 'Buyers can only cancel a placed order';
    end if;
  elsif auth.uid() = old.seller_id then
    if new.status not in ('placed', 'confirmed', 'shipped', 'delivered', 'cancelled')
      or new.payment_status not in ('unpaid', 'paid') then raise exception 'Invalid order status'; end if;
  end if;
  return new;
end;
$$;
drop trigger if exists protect_order_changes on public.orders;
create trigger protect_order_changes before update on public.orders
for each row execute procedure public.protect_order_changes();

create table if not exists public.support_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  name text not null default '',
  email text not null default '',
  contact text not null default '',
  subject text not null,
  message text not null check (char_length(message) <= 5000),
  source text not null,
  status text not null default 'open',
  created_at timestamptz not null default now()
);

create table if not exists public.app_config (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.product_likes enable row level security;
alter table public.product_comments enable row level security;
alter table public.cart_items enable row level security;
alter table public.wishlists enable row level security;
alter table public.product_audio enable row level security;
alter table public.orders enable row level security;
alter table public.support_requests enable row level security;
alter table public.app_config enable row level security;

grant usage on schema public to anon, authenticated;
grant select on public.products, public.product_likes, public.product_comments, public.product_audio, public.app_config to anon;
grant select, insert, update, delete on public.profiles, public.products, public.product_likes,
  public.product_comments, public.cart_items, public.wishlists, public.product_audio,
  public.orders, public.support_requests, public.app_config to authenticated;

drop policy if exists "profiles read own" on public.profiles;
create policy "profiles read own" on public.profiles for select to authenticated using (id = auth.uid());
drop policy if exists "profiles insert own" on public.profiles;
create policy "profiles insert own" on public.profiles for insert to authenticated with check (id = auth.uid() and role in ('buyer', 'seller') and official = false);
drop policy if exists "profiles update own" on public.profiles;
create policy "profiles update own" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid() and role in ('buyer', 'seller'));

drop policy if exists "products public read" on public.products;
create policy "products public read" on public.products for select using (true);
drop policy if exists "products seller insert" on public.products;
-- Guests (anonymous sign-ins) can browse and buy, but selling needs a real account.
create policy "products seller insert" on public.products for insert to authenticated with check (
  seller_id = auth.uid() and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false
);
drop policy if exists "products seller update" on public.products;
create policy "products seller update" on public.products for update to authenticated using (seller_id = auth.uid()) with check (seller_id = auth.uid());
drop policy if exists "products seller delete" on public.products;
create policy "products seller delete" on public.products for delete to authenticated using (seller_id = auth.uid());

drop policy if exists "likes public read" on public.product_likes;
create policy "likes public read" on public.product_likes for select using (true);
drop policy if exists "users manage own likes" on public.product_likes;
create policy "users manage own likes" on public.product_likes for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "comments public read" on public.product_comments;
create policy "comments public read" on public.product_comments for select using (true);
drop policy if exists "users insert own comments" on public.product_comments;
create policy "users insert own comments" on public.product_comments for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "comment owner or seller delete" on public.product_comments;
create policy "comment owner or seller delete" on public.product_comments for delete to authenticated using (
  user_id = auth.uid() or exists (select 1 from public.products p where p.id = product_id and p.seller_id = auth.uid())
);

drop policy if exists "users manage own cart" on public.cart_items;
create policy "users manage own cart" on public.cart_items for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "users manage own wishlists" on public.wishlists;
create policy "users manage own wishlists" on public.wishlists for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "product audio public read" on public.product_audio;
create policy "product audio public read" on public.product_audio for select using (true);
drop policy if exists "seller manages product audio" on public.product_audio;
create policy "seller manages product audio" on public.product_audio for all to authenticated using (
  seller_id = auth.uid() and exists (select 1 from public.products p where p.id = product_id and p.seller_id = auth.uid())
) with check (
  seller_id = auth.uid() and exists (select 1 from public.products p where p.id = product_id and p.seller_id = auth.uid())
);

drop policy if exists "order participants read" on public.orders;
create policy "order participants read" on public.orders for select to authenticated using (buyer_id = auth.uid() or seller_id = auth.uid());
drop policy if exists "seller updates order status" on public.orders;
create policy "seller updates order status" on public.orders for update to authenticated using (seller_id = auth.uid()) with check (seller_id = auth.uid());
drop policy if exists "buyer cancels placed order" on public.orders;
create policy "buyer cancels placed order" on public.orders for update to authenticated using (buyer_id = auth.uid() and status = 'placed') with check (buyer_id = auth.uid() and status = 'cancelled');

drop policy if exists "users create own support requests" on public.support_requests;
create policy "users create own support requests" on public.support_requests for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "support requests readable by owner" on public.support_requests;
create policy "support requests readable by owner" on public.support_requests for select to authenticated using (user_id = auth.uid());

drop policy if exists "app config public read" on public.app_config;
create policy "app config public read" on public.app_config for select using (true);
drop policy if exists "official manages app config" on public.app_config;
create policy "official manages app config" on public.app_config for all to authenticated using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.official)
) with check (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.official)
);

create or replace function public.place_orders(p_items jsonb, p_delivery jsonb, p_payment_method text)
returns uuid[] language plpgsql security definer set search_path = public, pg_temp as $$
declare
  buyer uuid := auth.uid();
  line jsonb;
  product_row public.products%rowtype;
  seller_key text;
  quantity integer;
  groups jsonb := '{}'::jsonb;
  group_data jsonb;
  created_ids uuid[] := '{}'::uuid[];
  new_id uuid;
  buyer_label text;
begin
  if buyer is null then raise exception 'Sign in before placing an order'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 50 then raise exception 'Order must contain between 1 and 50 items'; end if;
  if p_payment_method not in ('mobile_money', 'cash_on_delivery', 'pickup') then raise exception 'Unsupported payment method'; end if;
  buyer_label := coalesce(auth.jwt() -> 'user_metadata' ->> 'display_name', auth.jwt() -> 'user_metadata' ->> 'full_name', p_delivery ->> 'fullName', '');

  for line in select value from jsonb_array_elements(p_items) loop
    if coalesce(line ->> 'quantity', '') !~ '^[0-9]+$' then raise exception 'Invalid item quantity'; end if;
    quantity := (line ->> 'quantity')::integer;
    if quantity not between 1 and 99 then raise exception 'Item quantity must be between 1 and 99'; end if;
    select * into product_row from public.products
      where id = (line ->> 'productId')::uuid and status = 'active' for share;
    if not found then raise exception 'A product in this order is no longer available'; end if;
    seller_key := product_row.seller_id::text;
    group_data := coalesce(groups -> seller_key, jsonb_build_object('items', '[]'::jsonb, 'total', 0, 'shop', product_row.shop));
    group_data := jsonb_set(group_data, '{items}', (group_data -> 'items') || jsonb_build_array(jsonb_build_object(
      'productId', product_row.id, 'name', product_row.name, 'price', product_row.price, 'quantity', quantity
    )));
    group_data := jsonb_set(group_data, '{total}', to_jsonb((group_data ->> 'total')::numeric + product_row.price * quantity));
    groups := jsonb_set(groups, array[seller_key], group_data, true);
  end loop;

  for seller_key, group_data in select key, value from jsonb_each(groups) loop
    insert into public.orders(buyer_id, buyer_name, buyer_email, seller_id, shop, items, total, delivery, payment_method)
    values (buyer, buyer_label, coalesce(auth.jwt() ->> 'email', ''), seller_key::uuid,
      group_data -> 'shop', group_data -> 'items', (group_data ->> 'total')::numeric,
      coalesce(p_delivery, '{}'::jsonb), p_payment_method)
    returning id into new_id;
    created_ids := array_append(created_ids, new_id);
  end loop;
  return created_ids;
end;
$$;
revoke all on function public.place_orders(jsonb, jsonb, text) from public;
grant execute on function public.place_orders(jsonb, jsonb, text) to authenticated;

do $$
declare table_name text;
begin
  foreach table_name in array array['products', 'product_likes', 'product_comments', 'cart_items', 'wishlists', 'orders'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = table_name) then
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    end if;
  end loop;
end;
$$;
