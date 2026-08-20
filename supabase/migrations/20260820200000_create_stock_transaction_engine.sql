begin;

alter table public.stock_movements
  add column balance_before numeric(18, 3),
  add column balance_after numeric(18, 3),
  add constraint stock_movements_balance_before_nonnegative check (
    balance_before is null or balance_before >= 0
  ),
  add constraint stock_movements_balance_after_nonnegative check (
    balance_after is null or balance_after >= 0
  );

alter table public.stock_balances
  add column last_movement_id uuid references public.stock_movements (id) on delete restrict;

create index stock_balances_last_movement_id_idx
  on public.stock_balances (last_movement_id)
  where last_movement_id is not null;

create unique index stock_movements_single_opening_balance_per_product
  on public.stock_movements (product_id)
  where movement_type = 'MIGRATION_OPENING_BALANCE';

create function private.assert_active_location(
  location_id uuid,
  required_type public.location_type,
  field_name text
)
returns void
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
#variable_conflict use_variable
declare
  found_location public.locations%rowtype;
begin
  if location_id is null then
    raise exception using
      errcode = '22023',
      message = format('%s is required', field_name);
  end if;

  select location.*
  into found_location
  from public.locations location
  where location.id = location_id;

  if not found then
    raise exception using errcode = 'P0002', message = format('%s was not found', field_name);
  end if;

  if not found_location.is_active then
    raise exception using errcode = '22023', message = format('%s is inactive', field_name);
  end if;

  if found_location.location_type <> required_type then
    raise exception using
      errcode = '22023',
      message = format('%s must have type %s', field_name, required_type::text);
  end if;
end;
$$;

create function private.execute_stock_movement(
  operation_name text,
  product_id uuid,
  movement_type public.movement_type,
  movement_quantity numeric,
  balance_delta numeric,
  source_location_id uuid,
  destination_location_id uuid,
  invoice_id uuid,
  import_batch_id uuid,
  reference_movement_id uuid,
  movement_reason text,
  idempotency_key text,
  admin_only boolean
)
returns table (
  movement_id uuid,
  new_balance numeric(18, 3),
  applied boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
#variable_conflict use_variable
declare
  actor_id uuid := (select auth.uid());
  canonical_reason text := nullif(btrim(movement_reason), '');
  existing_movement public.stock_movements%rowtype;
  balance_before_value numeric(18, 3);
  balance_after_value numeric(18, 3);
  created_movement_id uuid;
begin
  if actor_id is null or not private.is_active_user() then
    raise exception using errcode = '42501', message = 'active authenticated user is required';
  end if;

  if admin_only then
    if not private.has_role('ADMIN') then
      raise exception using errcode = '42501', message = 'ADMIN role is required';
    end if;
  elsif not private.has_any_role(array['ADMIN', 'STOCK_OPERATOR']) then
    raise exception using errcode = '42501', message = 'stock operation role is required';
  end if;

  if product_id is null then
    raise exception using errcode = '22023', message = 'product_id is required';
  end if;

  if idempotency_key is null or btrim(idempotency_key) = '' then
    raise exception using errcode = '22023', message = 'idempotency_key is required';
  end if;

  if length(idempotency_key) > 200 then
    raise exception using errcode = '22023', message = 'idempotency_key exceeds 200 characters';
  end if;

  if movement_quantity is null or movement_quantity <= 0 then
    raise exception using errcode = '22023', message = 'quantity must be greater than zero';
  end if;

  if movement_quantity > 999999999999999.999
    or movement_quantity <> round(movement_quantity, 3)
  then
    raise exception using
      errcode = '22023',
      message = 'quantity must fit NUMERIC(18,3) without rounding';
  end if;

  if balance_delta is null
    or abs(balance_delta) > 999999999999999.999
    or balance_delta <> round(balance_delta, 3)
  then
    raise exception using
      errcode = '22023',
      message = 'balance delta must fit NUMERIC(18,3) without rounding';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('stock:idempotency:' || btrim(idempotency_key), 0)
  );
  perform pg_advisory_xact_lock(hashtextextended('stock:product:' || product_id::text, 0));

  select movement.*
  into existing_movement
  from public.stock_movements movement
  where movement.idempotency_key = btrim(idempotency_key);

  if found then
    if existing_movement.balance_before is null
      or existing_movement.balance_after is null
      or existing_movement.created_by is distinct from actor_id
      or existing_movement.product_id is distinct from product_id
      or existing_movement.movement_type is distinct from movement_type
      or existing_movement.quantity is distinct from movement_quantity
      or existing_movement.source_location_id is distinct from source_location_id
      or existing_movement.destination_location_id is distinct from destination_location_id
      or existing_movement.invoice_id is distinct from invoice_id
      or existing_movement.import_batch_id is distinct from import_batch_id
      or existing_movement.reference_id is distinct from reference_movement_id
      or existing_movement.reason is distinct from canonical_reason
    then
      raise exception using
        errcode = '22000',
        message = 'idempotency_key was already used with a different payload';
    end if;

    return query
    select existing_movement.id, existing_movement.balance_after, false;
    return;
  end if;

  case movement_type
    when 'PURCHASE_ENTRY' then
      perform private.assert_active_location(
        destination_location_id,
        'STOCK',
        'destination_location_id'
      );
    when 'CONSUMPTION_EXIT' then
      perform private.assert_active_location(source_location_id, 'STOCK', 'source_location_id');
      if destination_location_id is not null then
        perform private.assert_active_location(
          destination_location_id,
          'CONSUMPTION',
          'destination_location_id'
        );
      end if;
    when 'LOSS' then
      perform private.assert_active_location(source_location_id, 'STOCK', 'source_location_id');
    when 'ADJUSTMENT_POSITIVE' then
      perform private.assert_active_location(
        destination_location_id,
        'STOCK',
        'destination_location_id'
      );
    when 'ADJUSTMENT_NEGATIVE' then
      perform private.assert_active_location(source_location_id, 'STOCK', 'source_location_id');
    when 'TRANSFER' then
      perform private.assert_active_location(source_location_id, 'STOCK', 'source_location_id');
      perform private.assert_active_location(
        destination_location_id,
        'STOCK',
        'destination_location_id'
      );
    when 'MIGRATION_OPENING_BALANCE' then
      perform private.assert_active_location(
        destination_location_id,
        'STOCK',
        'destination_location_id'
      );
    else
      raise exception using errcode = '22023', message = 'unsupported movement type';
  end case;

  if not exists (
    select 1 from public.products product
    where product.id = product_id and product.is_active
  ) then
    raise exception using errcode = 'P0002', message = 'active product was not found';
  end if;

  if invoice_id is not null and not exists (
    select 1 from public.invoices invoice
    where invoice.id = invoice_id and invoice.status <> 'CANCELLED'
  ) then
    raise exception using errcode = 'P0002', message = 'valid invoice was not found';
  end if;

  if import_batch_id is not null and not exists (
    select 1 from public.import_batches batch
    where batch.id = import_batch_id and batch.status in ('READY', 'IMPORTING')
  ) then
    raise exception using errcode = 'P0002', message = 'ready import batch was not found';
  end if;

  if reference_movement_id is not null and not exists (
    select 1 from public.stock_movements reference
    where reference.id = reference_movement_id and reference.product_id = product_id
  ) then
    raise exception using
      errcode = 'P0002',
      message = 'reference movement for the same product was not found';
  end if;

  if movement_type = 'MIGRATION_OPENING_BALANCE' and exists (
    select 1 from public.stock_movements opening
    where opening.product_id = product_id
  ) then
    raise exception using
      errcode = '55000',
      message = 'product already has stock history; migration opening balance must be first';
  end if;

  insert into public.stock_balances (product_id, quantity)
  values (product_id, 0)
  on conflict on constraint stock_balances_pkey do nothing;

  select balance.quantity
  into balance_before_value
  from public.stock_balances balance
  where balance.product_id = product_id
  for update;

  balance_after_value := balance_before_value + balance_delta;
  if movement_type = 'MIGRATION_OPENING_BALANCE' and balance_before_value <> 0 then
    raise exception using
      errcode = '55000',
      message = 'migration opening balance requires a zero current balance';
  end if;
  if movement_type = 'TRANSFER' and balance_before_value < movement_quantity then
    raise exception using errcode = '23514', message = 'insufficient stock for transfer';
  end if;
  if balance_after_value < 0 then
    raise exception using errcode = '23514', message = 'insufficient stock; negative balance is forbidden';
  end if;

  insert into public.stock_movements (
    product_id,
    movement_type,
    quantity,
    source_location_id,
    destination_location_id,
    invoice_id,
    import_batch_id,
    reason,
    reference_id,
    idempotency_key,
    balance_before,
    balance_after,
    created_by
  ) values (
    product_id,
    movement_type,
    movement_quantity,
    source_location_id,
    destination_location_id,
    invoice_id,
    import_batch_id,
    canonical_reason,
    reference_movement_id,
    btrim(idempotency_key),
    balance_before_value,
    balance_after_value,
    actor_id
  )
  returning id into created_movement_id;

  update public.stock_balances
  set
    quantity = balance_after_value,
    last_movement_id = created_movement_id,
    updated_at = statement_timestamp()
  where stock_balances.product_id = product_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'stock balance update failed';
  end if;

  insert into public.audit_logs (
    actor_id,
    action,
    entity_type,
    entity_id,
    new_data,
    metadata
  ) values (
    actor_id,
    'STOCK_MOVEMENT_CREATED',
    'stock_movement',
    created_movement_id::text,
    jsonb_build_object(
      'operation', operation_name,
      'movement_type', movement_type::text,
      'product_id', product_id,
      'quantity', movement_quantity,
      'balance_before', balance_before_value,
      'balance_after', balance_after_value
    ),
    jsonb_build_object('idempotency_key', btrim(idempotency_key))
  );

  return query select created_movement_id, balance_after_value, true;
end;
$$;

create function public.receive_stock(
  p_product_id uuid,
  p_quantity numeric,
  p_destination_location_id uuid,
  p_idempotency_key text,
  p_invoice_id uuid default null,
  p_reason text default null
)
returns table (movement_id uuid, new_balance numeric(18, 3), applied boolean)
language sql
security definer
set search_path = pg_catalog
as $$
  select * from private.execute_stock_movement(
    'receive_stock', p_product_id, 'PURCHASE_ENTRY', p_quantity, p_quantity,
    null, p_destination_location_id, p_invoice_id, null, null,
    coalesce(nullif(btrim(p_reason), ''), 'Recebimento de estoque'),
    p_idempotency_key, false
  );
$$;

create function public.consume_stock(
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
  return query
  select * from private.execute_stock_movement(
    'consume_stock', p_product_id, 'CONSUMPTION_EXIT', p_quantity, -p_quantity,
    p_source_location_id, p_destination_location_id, null, null, null,
    coalesce(nullif(btrim(p_reason), ''), 'Consumo de estoque'),
    p_idempotency_key, false
  );
end;
$$;

create function public.register_loss(
  p_product_id uuid,
  p_quantity numeric,
  p_source_location_id uuid,
  p_reason text,
  p_idempotency_key text
)
returns table (movement_id uuid, new_balance numeric(18, 3), applied boolean)
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if p_reason is null or btrim(p_reason) = '' then
    raise exception using errcode = '22023', message = 'reason is required for loss';
  end if;

  return query
  select * from private.execute_stock_movement(
    'register_loss', p_product_id, 'LOSS', p_quantity, -p_quantity,
    p_source_location_id, null, null, null, null, p_reason,
    p_idempotency_key, false
  );
end;
$$;

create function public.adjust_stock(
  p_product_id uuid,
  p_quantity_delta numeric,
  p_location_id uuid,
  p_reason text,
  p_idempotency_key text,
  p_reference_movement_id uuid default null
)
returns table (movement_id uuid, new_balance numeric(18, 3), applied boolean)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  selected_type public.movement_type;
  source_id uuid;
  destination_id uuid;
begin
  if p_quantity_delta is null or p_quantity_delta = 0 then
    raise exception using errcode = '22023', message = 'adjustment delta cannot be zero';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception using errcode = '22023', message = 'reason is required for adjustment';
  end if;

  if p_quantity_delta > 0 then
    selected_type := 'ADJUSTMENT_POSITIVE';
    destination_id := p_location_id;
  else
    selected_type := 'ADJUSTMENT_NEGATIVE';
    source_id := p_location_id;
  end if;

  return query
  select * from private.execute_stock_movement(
    'adjust_stock', p_product_id, selected_type, abs(p_quantity_delta), p_quantity_delta,
    source_id, destination_id, null, null, p_reference_movement_id, p_reason,
    p_idempotency_key, true
  );
end;
$$;

create function public.transfer_stock(
  p_product_id uuid,
  p_quantity numeric,
  p_source_location_id uuid,
  p_destination_location_id uuid,
  p_idempotency_key text,
  p_reason text default null
)
returns table (movement_id uuid, new_balance numeric(18, 3), applied boolean)
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if p_source_location_id = p_destination_location_id then
    raise exception using errcode = '22023', message = 'transfer locations must be different';
  end if;

  return query
  select * from private.execute_stock_movement(
    'transfer_stock', p_product_id, 'TRANSFER', p_quantity, 0,
    p_source_location_id, p_destination_location_id, null, null, null,
    coalesce(nullif(btrim(p_reason), ''), 'Transferência de estoque'),
    p_idempotency_key, false
  );
end;
$$;

create function public.apply_migration_opening_balance(
  p_product_id uuid,
  p_quantity numeric,
  p_destination_location_id uuid,
  p_import_batch_id uuid,
  p_idempotency_key text
)
returns table (movement_id uuid, new_balance numeric(18, 3), applied boolean)
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if p_import_batch_id is null then
    raise exception using errcode = '22023', message = 'import_batch_id is required';
  end if;

  return query
  select * from private.execute_stock_movement(
    'apply_migration_opening_balance', p_product_id, 'MIGRATION_OPENING_BALANCE',
    p_quantity, p_quantity, null, p_destination_location_id, null, p_import_batch_id,
    null, 'Migração sistema legado', p_idempotency_key, true
  );
end;
$$;

revoke all on function private.assert_active_location(uuid, public.location_type, text)
from public, anon, authenticated;
revoke all on function private.execute_stock_movement(
  text, uuid, public.movement_type, numeric, numeric, uuid, uuid, uuid, uuid, uuid,
  text, text, boolean
) from public, anon, authenticated;

revoke all on function public.receive_stock(uuid, numeric, uuid, text, uuid, text)
from public, anon, authenticated;
revoke all on function public.consume_stock(uuid, numeric, uuid, text, uuid, text)
from public, anon, authenticated;
revoke all on function public.register_loss(uuid, numeric, uuid, text, text)
from public, anon, authenticated;
revoke all on function public.adjust_stock(uuid, numeric, uuid, text, text, uuid)
from public, anon, authenticated;
revoke all on function public.transfer_stock(uuid, numeric, uuid, uuid, text, text)
from public, anon, authenticated;
revoke all on function public.apply_migration_opening_balance(uuid, numeric, uuid, uuid, text)
from public, anon, authenticated;

grant execute on function public.receive_stock(uuid, numeric, uuid, text, uuid, text)
to authenticated;
grant execute on function public.consume_stock(uuid, numeric, uuid, text, uuid, text)
to authenticated;
grant execute on function public.register_loss(uuid, numeric, uuid, text, text)
to authenticated;
grant execute on function public.adjust_stock(uuid, numeric, uuid, text, text, uuid)
to authenticated;
grant execute on function public.transfer_stock(uuid, numeric, uuid, uuid, text, text)
to authenticated;
grant execute on function public.apply_migration_opening_balance(uuid, numeric, uuid, uuid, text)
to authenticated;

comment on function public.receive_stock(uuid, numeric, uuid, text, uuid, text) is
  'Entrada atômica e idempotente; cria PURCHASE_ENTRY e atualiza saldo central.';
comment on function public.consume_stock(uuid, numeric, uuid, text, uuid, text) is
  'Consumo atômico e idempotente com bloqueio contra saldo negativo.';
comment on function public.register_loss(uuid, numeric, uuid, text, text) is
  'Perda rastreável que exige motivo e nunca permite saldo negativo.';
comment on function public.adjust_stock(uuid, numeric, uuid, text, text, uuid) is
  'Ajuste administrativo compensatório; delta assinado escolhe movimento positivo ou negativo.';
comment on function public.transfer_stock(uuid, numeric, uuid, uuid, text, text) is
  'Transferência entre locais STOCK; preserva o saldo central agregado.';
comment on function public.apply_migration_opening_balance(uuid, numeric, uuid, uuid, text) is
  'Marco inicial administrativo vinculado ao import_batch; nunca sobrescreve saldo diretamente.';

commit;
