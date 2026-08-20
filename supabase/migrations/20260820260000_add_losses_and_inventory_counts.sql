begin;

create type public.inventory_count_status as enum (
  'DRAFT',
  'COUNTING',
  'REVIEW',
  'CONFIRMED'
);

create table public.stock_losses (
  id uuid primary key default gen_random_uuid(),
  movement_id uuid not null unique references public.stock_movements (id) on delete restrict,
  product_id uuid not null references public.products (id) on delete restrict,
  quantity numeric(18, 3) not null,
  unit public.unit_type not null,
  location_id uuid not null references public.locations (id) on delete restrict,
  reason text not null,
  notes text,
  idempotency_key text not null,
  created_at timestamptz not null default statement_timestamp(),
  created_by uuid not null references public.profiles (id) on delete restrict,
  constraint stock_losses_quantity_positive check (quantity > 0),
  constraint stock_losses_reason_not_blank check (btrim(reason) <> ''),
  constraint stock_losses_notes_not_blank check (notes is null or btrim(notes) <> ''),
  constraint stock_losses_idempotency_key_not_blank check (
    idempotency_key = btrim(idempotency_key) and idempotency_key <> ''
  ),
  constraint stock_losses_idempotency_key_length check (length(idempotency_key) <= 200),
  constraint stock_losses_idempotency_key_unique unique (idempotency_key)
);

create table public.inventory_counts (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations (id) on delete restrict,
  status public.inventory_count_status not null default 'DRAFT',
  reference text,
  notes text,
  created_at timestamptz not null default statement_timestamp(),
  created_by uuid not null references public.profiles (id) on delete restrict,
  started_at timestamptz,
  started_by uuid references public.profiles (id) on delete restrict,
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles (id) on delete restrict,
  confirmed_at timestamptz,
  confirmed_by uuid references public.profiles (id) on delete restrict,
  confirmation_idempotency_key text,
  confirmation_report jsonb,
  constraint inventory_counts_reference_not_blank check (
    reference is null or btrim(reference) <> ''
  ),
  constraint inventory_counts_notes_not_blank check (notes is null or btrim(notes) <> ''),
  constraint inventory_counts_confirmation_key_not_blank check (
    confirmation_idempotency_key is null
    or (
      confirmation_idempotency_key = btrim(confirmation_idempotency_key)
      and confirmation_idempotency_key <> ''
      and length(confirmation_idempotency_key) <= 200
    )
  ),
  constraint inventory_counts_confirmation_report_object check (
    confirmation_report is null or jsonb_typeof(confirmation_report) = 'object'
  ),
  constraint inventory_counts_lifecycle_consistent check (
    (status = 'DRAFT'
      and started_at is null and started_by is null
      and reviewed_at is null and reviewed_by is null
      and confirmed_at is null and confirmed_by is null
      and confirmation_idempotency_key is null and confirmation_report is null)
    or
    (status = 'COUNTING'
      and started_at is not null and started_by is not null
      and reviewed_at is null and reviewed_by is null
      and confirmed_at is null and confirmed_by is null
      and confirmation_idempotency_key is null and confirmation_report is null)
    or
    (status = 'REVIEW'
      and started_at is not null and started_by is not null
      and reviewed_at is not null and reviewed_by is not null
      and confirmed_at is null and confirmed_by is null
      and confirmation_idempotency_key is null and confirmation_report is null)
    or
    (status = 'CONFIRMED'
      and started_at is not null and started_by is not null
      and reviewed_at is not null and reviewed_by is not null
      and confirmed_at is not null and confirmed_by is not null
      and confirmation_idempotency_key is not null and confirmation_report is not null)
  ),
  constraint inventory_counts_confirmation_key_unique unique (confirmation_idempotency_key)
);

create table public.inventory_count_items (
  id uuid primary key default gen_random_uuid(),
  inventory_count_id uuid not null references public.inventory_counts (id) on delete restrict,
  product_id uuid not null references public.products (id) on delete restrict,
  unit public.unit_type not null,
  counted_quantity numeric(18, 3) not null,
  system_quantity numeric(18, 3),
  difference_quantity numeric(18, 3),
  movement_id uuid unique references public.stock_movements (id) on delete restrict,
  counted_at timestamptz not null default statement_timestamp(),
  counted_by uuid not null references public.profiles (id) on delete restrict,
  constraint inventory_count_items_count_product_unique unique (inventory_count_id, product_id),
  constraint inventory_count_items_counted_nonnegative check (counted_quantity >= 0),
  constraint inventory_count_items_system_nonnegative check (
    system_quantity is null or system_quantity >= 0
  ),
  constraint inventory_count_items_review_snapshot_consistent check (
    (system_quantity is null and difference_quantity is null)
    or
    (
      system_quantity is not null
      and difference_quantity = counted_quantity - system_quantity
    )
  )
);

create index stock_losses_product_created_at_idx
  on public.stock_losses (product_id, created_at desc);
create index stock_losses_location_created_at_idx
  on public.stock_losses (location_id, created_at desc);
create index stock_losses_created_by_idx on public.stock_losses (created_by);
create index inventory_counts_location_status_idx
  on public.inventory_counts (location_id, status, created_at desc);
create index inventory_counts_created_by_idx on public.inventory_counts (created_by);
create index inventory_counts_confirmed_by_idx
  on public.inventory_counts (confirmed_by) where confirmed_by is not null;
create index inventory_count_items_product_idx on public.inventory_count_items (product_id);
create index inventory_count_items_counted_by_idx on public.inventory_count_items (counted_by);

create trigger stock_losses_prevent_update
before update on public.stock_losses
for each statement execute function private.prevent_history_mutation();

create trigger stock_losses_prevent_delete
before delete on public.stock_losses
for each statement execute function private.prevent_history_mutation();

create function private.protect_inventory_count_history()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '55000', message = 'inventory counts cannot be deleted';
  end if;

  if old.status = 'CONFIRMED' then
    raise exception using errcode = '55000', message = 'confirmed inventory counts are immutable';
  end if;

  return new;
end;
$$;

create function private.protect_inventory_count_item_history()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  count_status public.inventory_count_status;
begin
  select inventory.status
  into count_status
  from public.inventory_counts inventory
  where inventory.id = old.inventory_count_id;

  if count_status = 'CONFIRMED' then
    raise exception using errcode = '55000', message = 'confirmed inventory count items are immutable';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function private.protect_inventory_count_history()
from public, anon, authenticated;
revoke all on function private.protect_inventory_count_item_history()
from public, anon, authenticated;

create trigger inventory_counts_protect_history
before update or delete on public.inventory_counts
for each row execute function private.protect_inventory_count_history();

create trigger inventory_count_items_protect_history
before update or delete on public.inventory_count_items
for each row execute function private.protect_inventory_count_item_history();

alter table public.stock_losses enable row level security;
alter table public.stock_losses force row level security;
alter table public.inventory_counts enable row level security;
alter table public.inventory_counts force row level security;
alter table public.inventory_count_items enable row level security;
alter table public.inventory_count_items force row level security;

revoke all on public.stock_losses from public, anon, authenticated;
revoke all on public.inventory_counts from public, anon, authenticated;
revoke all on public.inventory_count_items from public, anon, authenticated;
grant select on public.stock_losses to authenticated;
grant select on public.inventory_counts to authenticated;
grant select on public.inventory_count_items to authenticated;

create policy stock_losses_read_authorized
on public.stock_losses for select to authenticated
using (
  private.is_active_user()
  and private.has_any_role(array['ADMIN', 'STOCK_OPERATOR', 'VIEWER'])
);

create policy inventory_counts_read_authorized
on public.inventory_counts for select to authenticated
using (
  private.is_active_user()
  and private.has_any_role(array['ADMIN', 'STOCK_OPERATOR', 'VIEWER'])
);

create policy inventory_count_items_read_authorized
on public.inventory_count_items for select to authenticated
using (
  private.is_active_user()
  and private.has_any_role(array['ADMIN', 'STOCK_OPERATOR', 'VIEWER'])
);

create function private.stock_loss_report(requested_loss_id uuid, was_applied boolean)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select jsonb_build_object(
    'lossId', loss.id,
    'movementId', loss.movement_id,
    'productId', loss.product_id,
    'quantity', loss.quantity::text,
    'unit', loss.unit::text,
    'locationId', loss.location_id,
    'reason', loss.reason,
    'notes', loss.notes,
    'idempotencyKey', loss.idempotency_key,
    'createdAt', loss.created_at,
    'createdBy', loss.created_by,
    'newBalance', movement.balance_after::text,
    'applied', was_applied
  )
  from public.stock_losses loss
  join public.stock_movements movement on movement.id = loss.movement_id
  where loss.id = requested_loss_id;
$$;

revoke all on function private.stock_loss_report(uuid, boolean)
from public, anon, authenticated;

create function public.register_stock_loss(
  p_product_id uuid,
  p_quantity numeric,
  p_location_id uuid,
  p_reason text,
  p_notes text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
#variable_conflict use_variable
declare
  actor_id uuid := (select auth.uid());
  canonical_reason text := nullif(btrim(p_reason), '');
  canonical_notes text := nullif(btrim(p_notes), '');
  canonical_key text := nullif(btrim(p_idempotency_key), '');
  existing_loss public.stock_losses%rowtype;
  movement_result record;
  created_loss_id uuid;
  movement_key text;
begin
  if actor_id is null or not private.is_active_user() then
    raise exception using errcode = '42501', message = 'active authenticated user is required';
  end if;

  if not private.has_any_role(array['ADMIN', 'STOCK_OPERATOR']) then
    raise exception using errcode = '42501', message = 'stock operation role is required';
  end if;

  if canonical_reason is null then
    raise exception using errcode = '22023', message = 'reason is required for loss';
  end if;

  if length(canonical_reason) > 500 then
    raise exception using errcode = '22023', message = 'loss reason exceeds 500 characters';
  end if;

  if canonical_notes is not null and length(canonical_notes) > 2000 then
    raise exception using errcode = '22023', message = 'loss notes exceed 2000 characters';
  end if;

  if canonical_key is null then
    raise exception using errcode = '22023', message = 'idempotency_key is required';
  end if;

  if length(canonical_key) > 200 then
    raise exception using errcode = '22023', message = 'idempotency_key exceeds 200 characters';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('stock:loss:' || canonical_key, 0));

  select loss.*
  into existing_loss
  from public.stock_losses loss
  where loss.idempotency_key = canonical_key;

  if found then
    if existing_loss.created_by is distinct from actor_id
      or existing_loss.product_id is distinct from p_product_id
      or existing_loss.quantity is distinct from p_quantity
      or existing_loss.location_id is distinct from p_location_id
      or existing_loss.reason is distinct from canonical_reason
      or existing_loss.notes is distinct from canonical_notes
    then
      raise exception using
        errcode = '22000',
        message = 'idempotency_key was already used with a different stock loss payload';
    end if;

    return private.stock_loss_report(existing_loss.id, false);
  end if;

  movement_key := 'stock-loss:' || md5(actor_id::text || ':' || canonical_key);
  select *
  into movement_result
  from public.register_loss(
    p_product_id,
    p_quantity,
    p_location_id,
    canonical_reason,
    movement_key
  );

  if not movement_result.applied then
    raise exception using errcode = '22000', message = 'loss unexpectedly reused an existing movement';
  end if;

  insert into public.stock_losses (
    movement_id,
    product_id,
    quantity,
    unit,
    location_id,
    reason,
    notes,
    idempotency_key,
    created_by
  )
  select
    movement.id,
    movement.product_id,
    movement.quantity,
    movement.unit,
    p_location_id,
    canonical_reason,
    canonical_notes,
    canonical_key,
    actor_id
  from public.stock_movements movement
  where movement.id = movement_result.movement_id
  returning id into created_loss_id;

  if created_loss_id is null then
    raise exception using errcode = 'P0002', message = 'created loss movement was not found';
  end if;

  insert into public.audit_logs (
    actor_id, action, entity_type, entity_id, new_data, metadata
  ) values (
    actor_id,
    'STOCK_LOSS_REGISTERED',
    'stock_loss',
    created_loss_id::text,
    jsonb_build_object(
      'product_id', p_product_id,
      'quantity', p_quantity,
      'location_id', p_location_id,
      'reason', canonical_reason
    ),
    jsonb_build_object('idempotency_key', canonical_key, 'movement_id', movement_result.movement_id)
  );

  return private.stock_loss_report(created_loss_id, true);
end;
$$;

create function private.inventory_count_report(
  requested_inventory_count_id uuid,
  was_applied boolean
)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select jsonb_build_object(
    'inventoryCountId', inventory.id,
    'locationId', inventory.location_id,
    'status', inventory.status::text,
    'reference', inventory.reference,
    'notes', inventory.notes,
    'createdAt', inventory.created_at,
    'createdBy', inventory.created_by,
    'startedAt', inventory.started_at,
    'startedBy', inventory.started_by,
    'reviewedAt', inventory.reviewed_at,
    'reviewedBy', inventory.reviewed_by,
    'confirmedAt', inventory.confirmed_at,
    'confirmedBy', inventory.confirmed_by,
    'confirmationIdempotencyKey', inventory.confirmation_idempotency_key,
    'itemCount', (
      select count(*)::integer from public.inventory_count_items item
      where item.inventory_count_id = inventory.id
    ),
    'positiveAdjustments', (
      select count(*)::integer from public.inventory_count_items item
      where item.inventory_count_id = inventory.id and item.difference_quantity > 0
    ),
    'negativeAdjustments', (
      select count(*)::integer from public.inventory_count_items item
      where item.inventory_count_id = inventory.id and item.difference_quantity < 0
    ),
    'unchangedItems', (
      select count(*)::integer from public.inventory_count_items item
      where item.inventory_count_id = inventory.id and item.difference_quantity = 0
    ),
    'movementsCreated', (
      select count(*)::integer from public.inventory_count_items item
      where item.inventory_count_id = inventory.id and item.movement_id is not null
    ),
    'applied', was_applied,
    'items', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'itemId', item.id,
          'productId', item.product_id,
          'unit', item.unit::text,
          'countedQuantity', item.counted_quantity::text,
          'systemQuantity', item.system_quantity::text,
          'differenceQuantity', item.difference_quantity::text,
          'movementId', item.movement_id,
          'countedAt', item.counted_at,
          'countedBy', item.counted_by
        ) order by item.product_id
      )
      from public.inventory_count_items item
      where item.inventory_count_id = inventory.id
    ), '[]'::jsonb)
  )
  from public.inventory_counts inventory
  where inventory.id = requested_inventory_count_id;
$$;

revoke all on function private.inventory_count_report(uuid, boolean)
from public, anon, authenticated;

create function private.assert_inventory_operator()
returns uuid
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare
  actor_id uuid := (select auth.uid());
begin
  if actor_id is null or not private.is_active_user() then
    raise exception using errcode = '42501', message = 'active authenticated user is required';
  end if;

  if not private.has_any_role(array['ADMIN', 'STOCK_OPERATOR']) then
    raise exception using errcode = '42501', message = 'inventory operation role is required';
  end if;

  return actor_id;
end;
$$;

revoke all on function private.assert_inventory_operator()
from public, anon, authenticated;

create function public.create_inventory_count(
  p_location_id uuid,
  p_reference text default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  actor_id uuid := private.assert_inventory_operator();
  canonical_reference text := nullif(btrim(p_reference), '');
  canonical_notes text := nullif(btrim(p_notes), '');
  created_count_id uuid;
begin
  perform private.assert_active_location(p_location_id, 'STOCK', 'location_id');

  if canonical_reference is not null and length(canonical_reference) > 200 then
    raise exception using errcode = '22023', message = 'inventory reference exceeds 200 characters';
  end if;

  if canonical_notes is not null and length(canonical_notes) > 2000 then
    raise exception using errcode = '22023', message = 'inventory notes exceed 2000 characters';
  end if;

  insert into public.inventory_counts (
    location_id, reference, notes, created_by
  ) values (
    p_location_id, canonical_reference, canonical_notes, actor_id
  ) returning id into created_count_id;

  insert into public.audit_logs (
    actor_id, action, entity_type, entity_id, new_data
  ) values (
    actor_id,
    'INVENTORY_COUNT_CREATED',
    'inventory_count',
    created_count_id::text,
    jsonb_build_object('location_id', p_location_id, 'status', 'DRAFT')
  );

  return private.inventory_count_report(created_count_id, true);
end;
$$;

create function public.open_inventory_count(p_inventory_count_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
#variable_conflict use_variable
declare
  actor_id uuid := private.assert_inventory_operator();
  inventory public.inventory_counts%rowtype;
begin
  select count_record.*
  into inventory
  from public.inventory_counts count_record
  where count_record.id = p_inventory_count_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'inventory count was not found';
  end if;

  if inventory.status not in ('DRAFT', 'REVIEW') then
    raise exception using
      errcode = '55000',
      message = 'inventory count can enter COUNTING only from DRAFT or REVIEW';
  end if;

  if inventory.status = 'REVIEW' then
    update public.inventory_count_items
    set system_quantity = null, difference_quantity = null, movement_id = null
    where inventory_count_id = inventory.id;
  end if;

  update public.inventory_counts
  set
    status = 'COUNTING',
    started_at = coalesce(started_at, statement_timestamp()),
    started_by = coalesce(started_by, actor_id),
    reviewed_at = null,
    reviewed_by = null
  where id = inventory.id;

  insert into public.audit_logs (
    actor_id, action, entity_type, entity_id, new_data
  ) values (
    actor_id,
    'INVENTORY_COUNT_OPENED',
    'inventory_count',
    inventory.id::text,
    jsonb_build_object('status', 'COUNTING')
  );

  return private.inventory_count_report(inventory.id, true);
end;
$$;

create function public.save_inventory_count_items(
  p_inventory_count_id uuid,
  p_items jsonb,
  p_replace boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
#variable_conflict use_variable
declare
  actor_id uuid := private.assert_inventory_operator();
  inventory public.inventory_counts%rowtype;
  raw_item jsonb;
  item_product_id uuid;
  item_counted_quantity numeric;
  item_unit public.unit_type;
  seen_products uuid[] := array[]::uuid[];
begin
  select count_record.*
  into inventory
  from public.inventory_counts count_record
  where count_record.id = p_inventory_count_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'inventory count was not found';
  end if;

  if inventory.status <> 'COUNTING' then
    raise exception using errcode = '55000', message = 'items can be saved only while COUNTING';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception using errcode = '22023', message = 'items must be a JSON array';
  end if;

  if jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 5000 then
    raise exception using errcode = '22023', message = 'items must contain between 1 and 5000 entries';
  end if;

  if p_replace then
    delete from public.inventory_count_items where inventory_count_id = inventory.id;
  end if;

  for raw_item in select value from jsonb_array_elements(p_items)
  loop
    if jsonb_typeof(raw_item) <> 'object'
      or not raw_item ? 'product_id'
      or not raw_item ? 'counted_quantity'
      or (raw_item - array['product_id', 'counted_quantity']::text[]) <> '{}'::jsonb
    then
      raise exception using
        errcode = '22023',
        message = 'each item must contain only product_id and counted_quantity';
    end if;

    begin
      item_product_id := nullif(btrim(raw_item ->> 'product_id'), '')::uuid;
    exception when invalid_text_representation then
      raise exception using errcode = '22023', message = 'inventory item has an invalid product_id';
    end;

    if item_product_id is null then
      raise exception using errcode = '22023', message = 'inventory item requires product_id';
    end if;

    if item_product_id = any(seen_products) then
      raise exception using errcode = '22023', message = 'inventory item product is duplicated';
    end if;
    seen_products := array_append(seen_products, item_product_id);

    begin
      item_counted_quantity := nullif(btrim(raw_item ->> 'counted_quantity'), '')::numeric;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception using errcode = '22023', message = 'inventory item has an invalid quantity';
    end;

    if item_counted_quantity is null
      or item_counted_quantity < 0
      or item_counted_quantity > 999999999999999.999
      or item_counted_quantity <> round(item_counted_quantity, 3)
    then
      raise exception using
        errcode = '22023',
        message = 'counted quantity must fit NUMERIC(18,3) and be nonnegative';
    end if;

    select product.unit
    into item_unit
    from public.products product
    where product.id = item_product_id and product.is_active;

    if not found then
      raise exception using errcode = 'P0002', message = 'active inventory product was not found';
    end if;

    insert into public.inventory_count_items (
      inventory_count_id,
      product_id,
      unit,
      counted_quantity,
      counted_at,
      counted_by
    ) values (
      inventory.id,
      item_product_id,
      item_unit,
      item_counted_quantity,
      statement_timestamp(),
      actor_id
    )
    on conflict (inventory_count_id, product_id) do update
    set
      unit = excluded.unit,
      counted_quantity = excluded.counted_quantity,
      system_quantity = null,
      difference_quantity = null,
      movement_id = null,
      counted_at = excluded.counted_at,
      counted_by = excluded.counted_by;
  end loop;

  insert into public.audit_logs (
    actor_id, action, entity_type, entity_id, new_data
  ) values (
    actor_id,
    'INVENTORY_COUNT_ITEMS_SAVED',
    'inventory_count',
    inventory.id::text,
    jsonb_build_object(
      'submitted_item_count', jsonb_array_length(p_items),
      'replace', p_replace
    )
  );

  return private.inventory_count_report(inventory.id, true);
end;
$$;

create function public.review_inventory_count(p_inventory_count_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
#variable_conflict use_variable
declare
  actor_id uuid := private.assert_inventory_operator();
  inventory public.inventory_counts%rowtype;
begin
  select count_record.*
  into inventory
  from public.inventory_counts count_record
  where count_record.id = p_inventory_count_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'inventory count was not found';
  end if;

  if inventory.status <> 'COUNTING' then
    raise exception using errcode = '55000', message = 'inventory count must be COUNTING before REVIEW';
  end if;

  if not exists (
    select 1 from public.inventory_count_items item
    where item.inventory_count_id = inventory.id
  ) then
    raise exception using errcode = '22023', message = 'inventory count requires at least one item';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('stock:product:' || item.product_id::text, 0)
  )
  from public.inventory_count_items item
  where item.inventory_count_id = inventory.id
  order by item.product_id;

  if exists (
    select 1
    from public.inventory_count_items item
    join public.products product on product.id = item.product_id
    where item.inventory_count_id = inventory.id and not product.is_active
  ) then
    raise exception using errcode = '55000', message = 'inventory count contains an inactive product';
  end if;

  update public.inventory_count_items item
  set
    system_quantity = coalesce((
      select balance.quantity from public.stock_balances balance
      where balance.product_id = item.product_id
    ), 0),
    difference_quantity = item.counted_quantity - coalesce((
      select balance.quantity from public.stock_balances balance
      where balance.product_id = item.product_id
    ), 0)
  where item.inventory_count_id = inventory.id;

  update public.inventory_counts
  set
    status = 'REVIEW',
    reviewed_at = statement_timestamp(),
    reviewed_by = actor_id
  where id = inventory.id;

  insert into public.audit_logs (
    actor_id, action, entity_type, entity_id, new_data
  ) values (
    actor_id,
    'INVENTORY_COUNT_REVIEWED',
    'inventory_count',
    inventory.id::text,
    jsonb_build_object('status', 'REVIEW')
  );

  return private.inventory_count_report(inventory.id, true);
end;
$$;

create function public.confirm_inventory_count(
  p_inventory_count_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
#variable_conflict use_variable
declare
  actor_id uuid := (select auth.uid());
  canonical_key text := nullif(btrim(p_idempotency_key), '');
  inventory public.inventory_counts%rowtype;
  item public.inventory_count_items%rowtype;
  movement_result record;
  confirmation_reason text;
  confirmed_timestamp timestamptz := statement_timestamp();
  report jsonb;
begin
  if actor_id is null or not private.is_active_user() then
    raise exception using errcode = '42501', message = 'active authenticated user is required';
  end if;

  if not private.has_role('ADMIN') then
    raise exception using errcode = '42501', message = 'ADMIN role is required';
  end if;

  if canonical_key is null then
    raise exception using errcode = '22023', message = 'idempotency_key is required';
  end if;

  if length(canonical_key) > 200 then
    raise exception using errcode = '22023', message = 'idempotency_key exceeds 200 characters';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('stock:inventory-count:' || p_inventory_count_id::text, 0)
  );

  select count_record.*
  into inventory
  from public.inventory_counts count_record
  where count_record.id = p_inventory_count_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'inventory count was not found';
  end if;

  if inventory.status = 'CONFIRMED' then
    if inventory.confirmation_idempotency_key <> canonical_key
      or inventory.confirmed_by is distinct from actor_id
    then
      raise exception using
        errcode = '22000',
        message = 'inventory count was already confirmed with a different idempotency payload';
    end if;

    return jsonb_set(inventory.confirmation_report, '{applied}', 'false'::jsonb, true);
  end if;

  if inventory.status <> 'REVIEW' then
    raise exception using errcode = '55000', message = 'inventory count must be REVIEW before confirmation';
  end if;

  perform private.assert_active_location(inventory.location_id, 'STOCK', 'location_id');

  perform pg_advisory_xact_lock(
    hashtextextended('stock:product:' || count_item.product_id::text, 0)
  )
  from public.inventory_count_items count_item
  where count_item.inventory_count_id = inventory.id
  order by count_item.product_id;

  if exists (
    select 1
    from public.inventory_count_items count_item
    left join public.stock_balances balance on balance.product_id = count_item.product_id
    where count_item.inventory_count_id = inventory.id
      and coalesce(balance.quantity, 0) is distinct from count_item.system_quantity
  ) then
    raise exception using
      errcode = '40001',
      message = 'stock balance changed since inventory review; return to COUNTING and review again';
  end if;

  confirmation_reason := 'Reconciliação do inventário ' || inventory.id::text;

  for item in
    select count_item.*
    from public.inventory_count_items count_item
    where count_item.inventory_count_id = inventory.id
    order by count_item.product_id
  loop
    if item.difference_quantity <> 0 then
      select *
      into movement_result
      from public.adjust_stock(
        item.product_id,
        item.difference_quantity,
        inventory.location_id,
        confirmation_reason,
        'inventory-count:' || inventory.id::text || ':' || item.product_id::text,
        null
      );

      if not movement_result.applied then
        raise exception using
          errcode = '22000',
          message = 'inventory item unexpectedly reused an existing adjustment';
      end if;

      update public.inventory_count_items
      set movement_id = movement_result.movement_id
      where id = item.id;
    end if;
  end loop;

  report := private.inventory_count_report(inventory.id, true)
    || jsonb_build_object(
      'status', 'CONFIRMED',
      'confirmedAt', confirmed_timestamp,
      'confirmedBy', actor_id,
      'confirmationIdempotencyKey', canonical_key,
      'applied', true
    );

  update public.inventory_counts
  set
    status = 'CONFIRMED',
    confirmed_at = confirmed_timestamp,
    confirmed_by = actor_id,
    confirmation_idempotency_key = canonical_key,
    confirmation_report = report
  where id = inventory.id;

  insert into public.audit_logs (
    actor_id, action, entity_type, entity_id, new_data, metadata
  ) values (
    actor_id,
    'INVENTORY_COUNT_CONFIRMED',
    'inventory_count',
    inventory.id::text,
    jsonb_build_object(
      'status', 'CONFIRMED',
      'movements_created', report -> 'movementsCreated'
    ),
    jsonb_build_object('idempotency_key', canonical_key)
  );

  return report;
end;
$$;

revoke all on function public.register_stock_loss(uuid, numeric, uuid, text, text, text)
from public, anon, authenticated;
revoke all on function public.create_inventory_count(uuid, text, text)
from public, anon, authenticated;
revoke all on function public.open_inventory_count(uuid)
from public, anon, authenticated;
revoke all on function public.save_inventory_count_items(uuid, jsonb, boolean)
from public, anon, authenticated;
revoke all on function public.review_inventory_count(uuid)
from public, anon, authenticated;
revoke all on function public.confirm_inventory_count(uuid, text)
from public, anon, authenticated;

grant execute on function public.register_stock_loss(uuid, numeric, uuid, text, text, text)
to authenticated;
grant execute on function public.create_inventory_count(uuid, text, text)
to authenticated;
grant execute on function public.open_inventory_count(uuid)
to authenticated;
grant execute on function public.save_inventory_count_items(uuid, jsonb, boolean)
to authenticated;
grant execute on function public.review_inventory_count(uuid)
to authenticated;
grant execute on function public.confirm_inventory_count(uuid, text)
to authenticated;

comment on table public.stock_losses is
  'Registro append-only da perda, com motivo e observação, vinculado ao movimento LOSS definitivo.';
comment on table public.inventory_counts is
  'Cabeçalho do inventário DRAFT -> COUNTING -> REVIEW -> CONFIRMED; somente confirmação ajusta saldo.';
comment on table public.inventory_count_items is
  'Contagem física, snapshot do saldo revisado, diferença e movimento compensatório por produto.';
comment on function public.register_stock_loss(uuid, numeric, uuid, text, text, text) is
  'Registra perda rastreável exclusivamente por register_loss, sem escrita direta no saldo.';
comment on function public.confirm_inventory_count(uuid, text) is
  'Confirma inventário idempotente e chama adjust_stock para cada diferença em transação única.';

commit;
