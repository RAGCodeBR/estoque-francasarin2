begin;

alter table public.stock_movements
  add column unit public.unit_type;

comment on column public.stock_movements.unit is
  'Snapshot da unidade do produto no instante do movimento; movimentos anteriores a esta migration podem permanecer nulos.';

create function private.capture_stock_movement_unit()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  product_unit public.unit_type;
begin
  select product.unit
  into product_unit
  from public.products product
  where product.id = new.product_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'product was not found while capturing unit';
  end if;

  new.unit := product_unit;
  return new;
end;
$$;

revoke all on function private.capture_stock_movement_unit()
from public, anon, authenticated;

create trigger stock_movements_capture_unit
before insert on public.stock_movements
for each row execute function private.capture_stock_movement_unit();

create table public.stock_consumption_batches (
  id uuid primary key default gen_random_uuid(),
  source_location_id uuid not null references public.locations (id) on delete restrict,
  destination_location_id uuid not null references public.locations (id) on delete restrict,
  idempotency_key text not null,
  items_payload jsonb not null,
  reason text not null,
  created_at timestamptz not null default statement_timestamp(),
  created_by uuid not null references public.profiles (id) on delete restrict,
  constraint stock_consumption_batches_locations_distinct check (
    source_location_id <> destination_location_id
  ),
  constraint stock_consumption_batches_idempotency_key_not_blank check (
    idempotency_key = btrim(idempotency_key) and idempotency_key <> ''
  ),
  constraint stock_consumption_batches_idempotency_key_length check (
    length(idempotency_key) <= 200
  ),
  constraint stock_consumption_batches_items_payload_array check (
    jsonb_typeof(items_payload) = 'array' and jsonb_array_length(items_payload) between 1 and 100
  ),
  constraint stock_consumption_batches_reason_not_blank check (btrim(reason) <> ''),
  constraint stock_consumption_batches_idempotency_key_unique unique (idempotency_key)
);

create table public.stock_consumption_batch_items (
  batch_id uuid not null references public.stock_consumption_batches (id) on delete restrict,
  line_number integer not null,
  movement_id uuid not null unique references public.stock_movements (id) on delete restrict,
  product_id uuid not null references public.products (id) on delete restrict,
  quantity numeric(18, 3) not null,
  unit public.unit_type not null,
  primary key (batch_id, line_number),
  constraint stock_consumption_batch_items_line_positive check (line_number > 0),
  constraint stock_consumption_batch_items_quantity_positive check (quantity > 0)
);

create index stock_consumption_batches_created_at_idx
  on public.stock_consumption_batches (created_at desc);
create index stock_consumption_batches_source_location_idx
  on public.stock_consumption_batches (source_location_id);
create index stock_consumption_batches_destination_location_idx
  on public.stock_consumption_batches (destination_location_id);
create index stock_consumption_batches_created_by_idx
  on public.stock_consumption_batches (created_by);
create index stock_consumption_batch_items_product_idx
  on public.stock_consumption_batch_items (product_id);

create trigger stock_consumption_batches_prevent_update
before update on public.stock_consumption_batches
for each statement execute function private.prevent_history_mutation();

create trigger stock_consumption_batches_prevent_delete
before delete on public.stock_consumption_batches
for each statement execute function private.prevent_history_mutation();

create trigger stock_consumption_batch_items_prevent_update
before update on public.stock_consumption_batch_items
for each statement execute function private.prevent_history_mutation();

create trigger stock_consumption_batch_items_prevent_delete
before delete on public.stock_consumption_batch_items
for each statement execute function private.prevent_history_mutation();

alter table public.stock_consumption_batches enable row level security;
alter table public.stock_consumption_batches force row level security;
alter table public.stock_consumption_batch_items enable row level security;
alter table public.stock_consumption_batch_items force row level security;

revoke all on public.stock_consumption_batches from public, anon, authenticated;
revoke all on public.stock_consumption_batch_items from public, anon, authenticated;
grant select on public.stock_consumption_batches to authenticated;
grant select on public.stock_consumption_batch_items to authenticated;

create policy stock_consumption_batches_read_authorized
on public.stock_consumption_batches
for select
to authenticated
using (
  private.is_active_user()
  and private.has_any_role(array['ADMIN', 'STOCK_OPERATOR', 'VIEWER'])
);

create policy stock_consumption_batch_items_read_authorized
on public.stock_consumption_batch_items
for select
to authenticated
using (
  private.is_active_user()
  and private.has_any_role(array['ADMIN', 'STOCK_OPERATOR', 'VIEWER'])
);

create or replace function public.consume_stock(
  p_product_id uuid,
  p_quantity numeric,
  p_source_location_id uuid,
  p_idempotency_key text,
  p_destination_location_id uuid default null,
  p_reason text default null
)
returns table (movement_id uuid, new_balance numeric(18, 3), applied boolean)
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if p_destination_location_id is null then
    raise exception using
      errcode = '22023',
      message = 'destination_location_id is required for stock consumption';
  end if;

  return query
  select * from private.execute_stock_movement(
    'consume_stock', p_product_id, 'CONSUMPTION_EXIT', p_quantity, -p_quantity,
    p_source_location_id, p_destination_location_id, null, null, null,
    coalesce(nullif(btrim(p_reason), ''), 'Consumo de estoque'),
    p_idempotency_key, false
  );
end;
$$;

create function private.stock_consumption_batch_report(
  requested_batch_id uuid,
  was_applied boolean
)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select jsonb_build_object(
    'batchId', batch.id,
    'sourceLocationId', batch.source_location_id,
    'destinationLocationId', batch.destination_location_id,
    'idempotencyKey', batch.idempotency_key,
    'reason', batch.reason,
    'createdAt', batch.created_at,
    'createdBy', batch.created_by,
    'movementCount', jsonb_array_length(batch.items_payload),
    'applied', was_applied,
    'items', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'lineNumber', item.line_number,
          'movementId', item.movement_id,
          'productId', item.product_id,
          'quantity', item.quantity::text,
          'unit', item.unit::text,
          'newBalance', movement.balance_after::text,
          'createdAt', movement.created_at,
          'createdBy', movement.created_by,
          'destinationLocationId', movement.destination_location_id
        ) order by item.line_number
      )
      from public.stock_consumption_batch_items item
      join public.stock_movements movement on movement.id = item.movement_id
      where item.batch_id = batch.id
    ), '[]'::jsonb)
  )
  from public.stock_consumption_batches batch
  where batch.id = requested_batch_id;
$$;

revoke all on function private.stock_consumption_batch_report(uuid, boolean)
from public, anon, authenticated;

create function public.consume_stock_batch(
  p_source_location_id uuid,
  p_destination_location_id uuid,
  p_items jsonb,
  p_idempotency_key text,
  p_reason text default null
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
  canonical_reason text := coalesce(nullif(btrim(p_reason), ''), 'Saída para local de consumo');
  canonical_items jsonb := '[]'::jsonb;
  existing_batch public.stock_consumption_batches%rowtype;
  created_batch_id uuid;
  raw_item jsonb;
  canonical_item jsonb;
  item_product_id uuid;
  item_quantity numeric;
  item_line_number integer;
  item_movement record;
  movement_key text;
begin
  if actor_id is null or not private.is_active_user() then
    raise exception using errcode = '42501', message = 'active authenticated user is required';
  end if;

  if not private.has_any_role(array['ADMIN', 'STOCK_OPERATOR']) then
    raise exception using errcode = '42501', message = 'stock operation role is required';
  end if;

  if canonical_key is null then
    raise exception using errcode = '22023', message = 'idempotency_key is required';
  end if;

  if length(canonical_key) > 200 then
    raise exception using errcode = '22023', message = 'idempotency_key exceeds 200 characters';
  end if;

  if p_source_location_id is null then
    raise exception using errcode = '22023', message = 'source_location_id is required';
  end if;

  if p_destination_location_id is null then
    raise exception using errcode = '22023', message = 'destination_location_id is required';
  end if;

  if p_source_location_id = p_destination_location_id then
    raise exception using errcode = '22023', message = 'source and destination locations must differ';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception using errcode = '22023', message = 'items must be a JSON array';
  end if;

  if jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 100 then
    raise exception using errcode = '22023', message = 'items must contain between 1 and 100 entries';
  end if;

  for raw_item, item_line_number in
    select value, ordinality::integer
    from jsonb_array_elements(p_items) with ordinality
  loop
    if jsonb_typeof(raw_item) <> 'object'
      or not raw_item ? 'product_id'
      or not raw_item ? 'quantity'
      or (raw_item - array['product_id', 'quantity']::text[]) <> '{}'::jsonb
    then
      raise exception using
        errcode = '22023',
        message = format('item %s must contain only product_id and quantity', item_line_number);
    end if;

    begin
      item_product_id := nullif(btrim(raw_item ->> 'product_id'), '')::uuid;
    exception when invalid_text_representation then
      raise exception using
        errcode = '22023',
        message = format('item %s has an invalid product_id', item_line_number);
    end;

    if item_product_id is null then
      raise exception using
        errcode = '22023',
        message = format('item %s requires product_id', item_line_number);
    end if;

    begin
      item_quantity := nullif(btrim(raw_item ->> 'quantity'), '')::numeric;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception using
        errcode = '22023',
        message = format('item %s has an invalid quantity', item_line_number);
    end;

    if item_quantity is null
      or item_quantity <= 0
      or item_quantity > 999999999999999.999
      or item_quantity <> round(item_quantity, 3)
    then
      raise exception using
        errcode = '22023',
        message = format('item %s quantity must fit NUMERIC(18,3) and be positive', item_line_number);
    end if;

    canonical_item := jsonb_build_object(
      'product_id', item_product_id,
      'quantity', item_quantity::numeric(18, 3)::text
    );
    canonical_items := canonical_items || jsonb_build_array(canonical_item);
  end loop;

  perform pg_advisory_xact_lock(
    hashtextextended('stock:consumption-batch:' || canonical_key, 0)
  );

  select batch.*
  into existing_batch
  from public.stock_consumption_batches batch
  where batch.idempotency_key = canonical_key;

  if found then
    if existing_batch.created_by is distinct from actor_id
      or existing_batch.source_location_id is distinct from p_source_location_id
      or existing_batch.destination_location_id is distinct from p_destination_location_id
      or existing_batch.items_payload is distinct from canonical_items
      or existing_batch.reason is distinct from canonical_reason
    then
      raise exception using
        errcode = '22000',
        message = 'idempotency_key was already used with a different stock output payload';
    end if;

    return private.stock_consumption_batch_report(existing_batch.id, false);
  end if;

  perform private.assert_active_location(p_source_location_id, 'STOCK', 'source_location_id');
  perform private.assert_active_location(
    p_destination_location_id,
    'CONSUMPTION',
    'destination_location_id'
  );

  perform pg_advisory_xact_lock(
    hashtextextended('stock:product:' || product_id_value::text, 0)
  )
  from (
    select distinct (value ->> 'product_id')::uuid as product_id_value
    from jsonb_array_elements(canonical_items)
  ) products_to_lock
  order by product_id_value;

  insert into public.stock_consumption_batches (
    source_location_id,
    destination_location_id,
    idempotency_key,
    items_payload,
    reason,
    created_by
  ) values (
    p_source_location_id,
    p_destination_location_id,
    canonical_key,
    canonical_items,
    canonical_reason,
    actor_id
  )
  returning id into created_batch_id;

  for canonical_item, item_line_number in
    select value, ordinality::integer
    from jsonb_array_elements(canonical_items) with ordinality
  loop
    item_product_id := (canonical_item ->> 'product_id')::uuid;
    item_quantity := (canonical_item ->> 'quantity')::numeric;
    movement_key := 'stock-output:' || md5(actor_id::text || ':' || canonical_key)
      || ':' || item_line_number::text;

    select *
    into item_movement
    from public.consume_stock(
      item_product_id,
      item_quantity,
      p_source_location_id,
      movement_key,
      p_destination_location_id,
      canonical_reason
    );

    if not item_movement.applied then
      raise exception using
        errcode = '22000',
        message = format('item %s unexpectedly reused an existing movement', item_line_number);
    end if;

    insert into public.stock_consumption_batch_items (
      batch_id,
      line_number,
      movement_id,
      product_id,
      quantity,
      unit
    )
    select
      created_batch_id,
      item_line_number,
      movement.id,
      movement.product_id,
      movement.quantity,
      movement.unit
    from public.stock_movements movement
    where movement.id = item_movement.movement_id;

    if not found then
      raise exception using errcode = 'P0002', message = 'created stock movement was not found';
    end if;
  end loop;

  insert into public.audit_logs (
    actor_id,
    action,
    entity_type,
    entity_id,
    new_data,
    metadata
  ) values (
    actor_id,
    'STOCK_CONSUMPTION_BATCH_CREATED',
    'stock_consumption_batch',
    created_batch_id::text,
    jsonb_build_object(
      'source_location_id', p_source_location_id,
      'destination_location_id', p_destination_location_id,
      'item_count', jsonb_array_length(canonical_items)
    ),
    jsonb_build_object('idempotency_key', canonical_key)
  );

  return private.stock_consumption_batch_report(created_batch_id, true);
end;
$$;

revoke all on function public.consume_stock_batch(uuid, uuid, jsonb, text, text)
from public, anon, authenticated;
grant execute on function public.consume_stock_batch(uuid, uuid, jsonb, text, text)
to authenticated;

comment on function public.consume_stock(uuid, numeric, uuid, text, uuid, text) is
  'Saída atômica e idempotente; exige destino CONSUMPTION e bloqueia saldo negativo.';
comment on function public.consume_stock_batch(uuid, uuid, jsonb, text, text) is
  'Saída de 1 a 100 itens para um local CONSUMPTION; usa consume_stock por item e confirma tudo ou nada.';
comment on table public.stock_consumption_batches is
  'Cabeçalho append-only e idempotente de uma saída individual ou em lote para local de consumo.';
comment on table public.stock_consumption_batch_items is
  'Itens append-only que vinculam cada linha da saída ao movimento definitivo de estoque.';

commit;
