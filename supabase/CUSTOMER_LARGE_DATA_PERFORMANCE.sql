-- Speed up large customer pools, rep assignment views, and follow-up screens.

create index if not exists customers_created_at_id_idx
on public.customers (created_at desc, id desc);

create index if not exists customers_assigned_employee_idx
on public.customers (assigned_employee);

create index if not exists customers_assigned_status_assigned_at_idx
on public.customers (assigned_employee, status, assigned_at desc);

create index if not exists customers_status_created_at_idx
on public.customers (status, created_at desc);

create index if not exists customers_status_appointment_date_idx
on public.customers (status, appointment_date asc);

create index if not exists customers_pool_created_at_idx
on public.customers (created_at desc, id desc)
where assigned_employee is null and status = 'pool';
