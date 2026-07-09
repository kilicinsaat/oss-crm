-- Restrict managers to their own assigned customers.
-- Boss keeps full customer access; managers and reps only see/update rows assigned to themselves.

drop policy if exists customers_select_by_role on public.customers;
drop policy if exists customers_insert_by_role on public.customers;
drop policy if exists customers_update_by_role on public.customers;

create policy customers_select_by_role
on public.customers
for select
to authenticated
using (
  public.current_user_customer_role() = 'boss'
  or (
    public.current_user_customer_role() in ('manager', 'employee')
    and assigned_employee = auth.uid()
  )
);

create policy customers_insert_by_role
on public.customers
for insert
to authenticated
with check (
  created_by = auth.uid()
  and (
    public.current_user_customer_role() = 'boss'
    or (
      public.current_user_customer_role() in ('manager', 'employee')
      and assigned_employee = auth.uid()
    )
  )
);

create policy customers_update_by_role
on public.customers
for update
to authenticated
using (
  public.current_user_customer_role() = 'boss'
  or (
    public.current_user_customer_role() in ('manager', 'employee')
    and assigned_employee = auth.uid()
  )
)
with check (
  public.current_user_customer_role() = 'boss'
  or (
    public.current_user_customer_role() in ('manager', 'employee')
    and assigned_employee = auth.uid()
  )
);
