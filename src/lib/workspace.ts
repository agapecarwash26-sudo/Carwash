import { supabase } from '@/lib/supabase';
import type { Appointment, CashMovement, CashRegister, Complaint, Customer, Employee, Expense, Order, OrderItem, Product, Service, Site, Subscription, UserAccount, Vehicle } from '@/types';

export async function loadWorkspaceData() {
  const [ordersResult, servicesResult] = await Promise.all([
    supabase.from('orders').select('id, order_number, customer_name, vehicle_label, total_usd, paid_usd, payment_method, status, assigned_employee, arrived_at, created_at, personal_items, vehicle_details').order('created_at', { ascending: false }).limit(100),
    supabase.from('services').select('id, name, category, price_usd, price_cdf, duration_minutes, is_active').eq('is_active', true).order('name'),
  ]);

  if (ordersResult.error) throw ordersResult.error;
  if (servicesResult.error) throw servicesResult.error;

  return {
    orders: (ordersResult.data ?? []) as Order[],
    services: (servicesResult.data ?? []) as Service[],
  };
}

export async function createOrder(input: {
  orderNumber: string;
  customerName: string;
  vehicleLabel: string;
  totalUsd: number;
  paymentMethod: string;
  service: Service;
  personalItems?: string;
  vehicleDetails?: string;
  isFreeVisit?: boolean;
}) {
  const { data: order, error: orderError } = await supabase.from('orders').insert({
    order_number: input.orderNumber,
    customer_name: input.customerName,
    vehicle_label: input.vehicleLabel,
    total_usd: input.isFreeVisit ? 0 : input.totalUsd,
    paid_usd: input.isFreeVisit ? 0 : input.totalUsd,
    payment_method: input.isFreeVisit ? 'Offert (fidélité)' : input.paymentMethod,
    status: 'queued',
    personal_items: input.personalItems || null,
    vehicle_details: input.vehicleDetails || null,
  }).select('id, order_number, customer_name, vehicle_label, total_usd, paid_usd, payment_method, status, assigned_employee, arrived_at, created_at, personal_items, vehicle_details').maybeSingle();

  if (orderError) throw orderError;
  if (!order) throw new Error("La commande n'a pas pu être enregistrée.");

  if (!input.isFreeVisit) {
    const { error: itemError } = await supabase.from('order_items').insert({
      order_id: order.id,
      service_id: input.service.id,
      service_name: input.service.name,
      quantity: 1,
      unit_price_usd: input.service.price_usd,
    });
    if (itemError) throw itemError;

    const { error: paymentError } = await supabase.from('payments').insert({
      order_id: order.id,
      method: input.paymentMethod,
      amount: input.totalUsd,
      currency: 'USD',
      status: 'succeeded',
    });
    if (paymentError) throw paymentError;
  } else {
    const { error: itemError } = await supabase.from('order_items').insert({
      order_id: order.id,
      service_id: input.service.id,
      service_name: `${input.service.name} (Offert - 5ème visite)`,
      quantity: 1,
      unit_price_usd: 0,
    });
    if (itemError) throw itemError;
  }

  return order as Order;
}

export async function updateOrderStatus(id: string, status: string) {
  const fields: Record<string, string> = { status };
  if (status === 'in_progress') fields.started_at = new Date().toISOString();
  if (status === 'completed') fields.completed_at = new Date().toISOString();
  const { error } = await supabase.from('orders').update(fields).eq('id', id);
  if (error) throw error;
}

// ---- Customers & Vehicles ----

export async function loadCustomers(): Promise<Customer[]> {
  const { data, error } = await supabase
    .from('customers')
    .select('id, full_name, phone, email, total_spent, visits, loyalty_points, created_at')
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw error;
  const customers = (data ?? []) as Customer[];

  const { data: vehicles, error: vError } = await supabase
    .from('vehicles')
    .select('id, customer_id, plate_number, brand, model, color, vehicle_type');
  if (vError) throw vError;

  const vehicleMap = new Map<string, string>();
  for (const v of (vehicles ?? []) as Vehicle[]) {
    if (v.customer_id && !vehicleMap.has(v.customer_id)) {
      vehicleMap.set(v.customer_id, `${v.brand} ${v.model} · ${v.plate_number}`.trim());
    }
  }
  return customers.map(c => ({ ...c, vehicle_label: vehicleMap.get(c.id) || '—' }));
}

export async function createCustomer(input: { full_name: string; phone: string; email?: string }): Promise<Customer> {
  const { data, error } = await supabase
    .from('customers')
    .insert({ full_name: input.full_name, phone: input.phone, email: input.email || null })
    .select('id, full_name, phone, email, total_spent, visits, loyalty_points, created_at')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Le client n'a pas pu être enregistré.");
  return data as Customer;
}

// ---- Products / Inventory ----

export async function loadProducts(): Promise<Product[]> {
  const { data, error } = await supabase
    .from('products')
    .select('id, name, category, unit, current_stock, minimum_stock, unit_cost')
    .order('name');
  if (error) throw error;
  return (data ?? []) as Product[];
}

export async function createProduct(input: { name: string; category: string; unit: string; current_stock: number; minimum_stock: number; unit_cost: number }): Promise<Product> {
  const { data, error } = await supabase
    .from('products')
    .insert(input)
    .select('id, name, category, unit, current_stock, minimum_stock, unit_cost')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("L'article n'a pas pu être ajouté.");
  return data as Product;
}

export async function recordStockMovement(productId: string, type: string, quantity: number, reason: string): Promise<void> {
  const { error: moveError } = await supabase.from('stock_movements').insert({ product_id: productId, type, quantity, reason });
  if (moveError) throw moveError;
  const { data: product } = await supabase.from('products').select('current_stock').eq('id', productId).maybeSingle();
  if (product) {
    const delta = type === 'in' ? quantity : -quantity;
    const newStock = Math.max(0, (product.current_stock as number) + delta);
    await supabase.from('products').update({ current_stock: newStock }).eq('id', productId);
  }
}

// ---- Expenses ----

export async function loadExpenses(): Promise<Expense[]> {
  const { data, error } = await supabase
    .from('expenses')
    .select('id, category, description, amount, currency, status, created_at')
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data ?? []) as Expense[];
}

export async function createExpense(input: { category: string; description: string; amount: number; currency: string }): Promise<Expense> {
  const { data, error } = await supabase
    .from('expenses')
    .insert({ ...input, status: 'pending' })
    .select('id, category, description, amount, currency, status, created_at')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("La dépense n'a pas pu être enregistrée.");
  return data as Expense;
}

export async function updateExpenseStatus(id: string, status: string): Promise<void> {
  const { error } = await supabase.from('expenses').update({ status }).eq('id', id);
  if (error) throw error;
}

// ---- Employees ----

export async function loadEmployees(): Promise<Employee[]> {
  const { data, error } = await supabase
    .from('employees')
    .select('id, full_name, role, phone, is_active, created_at')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as Employee[];
}

export async function createEmployee(input: { full_name: string; role: string; phone: string }): Promise<Employee> {
  const { data, error } = await supabase
    .from('employees')
    .insert({ ...input, is_active: true })
    .select('id, full_name, role, phone, is_active, created_at')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("L'employé n'a pas pu être ajouté.");
  return data as Employee;
}

// ---- Cash Registers ----

export async function loadCashRegister(): Promise<{ register: CashRegister | null; movements: CashMovement[] }> {
  const { data: reg, error: regError } = await supabase
    .from('cash_registers')
    .select('id, opening_usd, opening_cdf, closing_usd, closing_cdf, status, opened_at, closed_at')
    .eq('status', 'open')
    .order('opened_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (regError) throw regError;

  const register = reg as CashRegister | null;
  if (!register) return { register: null, movements: [] };

  const { data: moves, error: moveError } = await supabase
    .from('cash_movements')
    .select('id, cash_register_id, type, amount, currency, reason, created_at')
    .eq('cash_register_id', register.id)
    .order('created_at', { ascending: false })
    .limit(50);
  if (moveError) throw moveError;
  return { register, movements: (moves ?? []) as CashMovement[] };
}

export async function openCashRegister(openingUsd: number): Promise<CashRegister> {
  const { data, error } = await supabase
    .from('cash_registers')
    .insert({ opening_usd: openingUsd, status: 'open' })
    .select('id, opening_usd, opening_cdf, closing_usd, closing_cdf, status, opened_at, closed_at')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("La caisse n'a pas pu être ouverte.");
  await supabase.from('cash_movements').insert({ cash_register_id: data.id, type: 'opening', amount: openingUsd, currency: 'USD', reason: 'Fond de caisse' });
  return data as CashRegister;
}

export async function closeCashRegister(id: string, closingUsd: number): Promise<void> {
  const { error } = await supabase.from('cash_registers').update({ status: 'closed', closing_usd: closingUsd, closed_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}

// ---- Sites ----

export async function loadSites(): Promise<Site[]> {
  const { data, error } = await supabase.from('sites').select('id, name, address, phone, is_active').eq('is_active', true).order('name');
  if (error) throw error;
  return (data ?? []) as Site[];
}

// ---- Audit Logs ----

export async function loadAuditLogs(limit = 100): Promise<{ id: string; action: string; entity_type: string; entity_id: string | null; details: Record<string, unknown>; created_at: string }[]> {
  const { data, error } = await supabase.from('audit_logs').select('id, action, entity_type, entity_id, details, created_at').order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return (data ?? []) as { id: string; action: string; entity_type: string; entity_id: string | null; details: Record<string, unknown>; created_at: string }[];
}

export async function logAction(action: string, entityType: string, entityId: string | null, details: Record<string, unknown> = {}): Promise<void> {
  await supabase.from('audit_logs').insert({ action, entity_type: entityType, entity_id: entityId, details });
}

// ---- Order Items (for receipts) ----

export async function loadOrderItems(orderId: string): Promise<OrderItem[]> {
  const { data, error } = await supabase.from('order_items').select('id, service_name, quantity, unit_price_usd').eq('order_id', orderId);
  if (error) throw error;
  return (data ?? []) as OrderItem[];
}

// ---- Reports data ----

// ---- Subscriptions ----

export async function createSubscription(input: { customer_id: string; name: string; price_usd: number; allowed_washes: number | null; expires_at: string }): Promise<Subscription> {
  const { data, error } = await supabase.from('subscriptions').insert({ ...input, used_washes: 0, starts_at: new Date().toISOString().slice(0, 10), status: 'active' }).select('id, customer_id, name, price_usd, allowed_washes, used_washes, starts_at, expires_at, status').maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('L\'abonnement n\'a pas pu être créé.');
  return data as Subscription;
}

export async function loadCustomersForSelect(): Promise<{ id: string; full_name: string }[]> {
  const { data, error } = await supabase.from('customers').select('id, full_name').order('full_name').limit(200);
  if (error) throw error;
  return (data ?? []) as { id: string; full_name: string }[];
}

// ---- Appointments ----

export async function createAppointment(input: { customer_name: string; vehicle_label: string; service_name: string; starts_at: string }): Promise<Appointment> {
  const { data, error } = await supabase.from('appointments').insert({ ...input, status: 'confirmed' }).select('id, customer_name, vehicle_label, service_name, starts_at, status').maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Le rendez-vous n\'a pas pu être créé.');
  return data as Appointment;
}

// ---- Complaints ----

export async function createComplaint(input: { customer_name: string; subject: string; description: string; priority: string }): Promise<Complaint> {
  const caseNumber = `REC-${new Date().getFullYear()}-${String(Date.now()).slice(-3)}`;
  const { data, error } = await supabase.from('complaints').insert({ ...input, case_number: caseNumber, status: 'new' }).select('id, case_number, customer_name, subject, priority, status, created_at').maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('La réclamation n\'a pas pu être créée.');
  return data as Complaint;
}

// ---- Services ----

export async function createService(input: { name: string; category: string; price_usd: number; price_cdf: number; duration_minutes: number }): Promise<Service> {
  const { data, error } = await supabase.from('services').insert({ ...input, is_active: true }).select('id, name, category, price_usd, price_cdf, duration_minutes, is_active').maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Le service n\'a pas pu être créé.');
  return data as Service;
}

// ---- Sites (for settings) ----

export async function updateSite(id: string, input: { name: string; address: string; phone: string }): Promise<void> {
  const { error } = await supabase.from('sites').update(input).eq('id', id);
  if (error) throw error;
}

export async function loadSite(id: string): Promise<Site | null> {
  const { data, error } = await supabase.from('sites').select('id, name, address, phone, is_active').eq('id', id).maybeSingle();
  if (error) throw error;
  return data as Site | null;
}

export async function loadReportData() {
  const [ordersResult, expensesResult, servicesResult] = await Promise.all([
    supabase.from('orders').select('id, total_usd, status, created_at, payment_method').order('created_at', { ascending: false }).limit(500),
    supabase.from('expenses').select('id, category, amount, status, created_at').order('created_at', { ascending: false }).limit(200),
    supabase.from('order_items').select('order_id, service_name, quantity, unit_price_usd').order('created_at', { ascending: false }).limit(500),
  ]);
  if (ordersResult.error) throw ordersResult.error;
  if (expensesResult.error) throw expensesResult.error;
  if (servicesResult.error) throw servicesResult.error;
  return { orders: ordersResult.data ?? [], expenses: expensesResult.data ?? [], items: servicesResult.data ?? [] };
}

// ---- User Management (admin) ----

export async function loadUsers(): Promise<UserAccount[]> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Non connecté.');
  const apiUrl = `${import.meta.env.VITE_SUPABASE_URL ?? import.meta.env.SUPABASE_URL}/functions/v1/manage-users`;
  const res = await fetch(apiUrl, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Erreur ${res.status}`);
  }
  const data = await res.json();
  return data as UserAccount[];
}

export async function createUser(input: { email: string; password: string; full_name: string; role: string }): Promise<UserAccount> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Non connecté.');
  const apiUrl = `${import.meta.env.VITE_SUPABASE_URL ?? import.meta.env.SUPABASE_URL}/functions/v1/manage-users`;
  const res = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Erreur ${res.status}`);
  }
  return res.json();
}

export async function updateUserRole(id: string, role: string): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Non connecté.');
  const apiUrl = `${import.meta.env.VITE_SUPABASE_URL ?? import.meta.env.SUPABASE_URL}/functions/v1/manage-users`;
  const res = await fetch(apiUrl, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ id, role }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Erreur ${res.status}`);
  }
}

export async function deleteUser(id: string): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Non connecté.');
  const apiUrl = `${import.meta.env.VITE_SUPABASE_URL ?? import.meta.env.SUPABASE_URL}/functions/v1/manage-users?id=${id}`;
  const res = await fetch(apiUrl, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Erreur ${res.status}`);
  }
}

export async function updateEmployeePassword(userId: string, newPassword: string): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Non connecté.');
  const apiUrl = `${import.meta.env.VITE_SUPABASE_URL ?? import.meta.env.SUPABASE_URL}/functions/v1/manage-users`;
  const res = await fetch(apiUrl, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ id: userId, password: newPassword }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Erreur ${res.status}`);
  }
}

// ---- App Settings ----

export async function loadSettings(): Promise<Record<string, string>> {
  const { data, error } = await supabase.from('app_settings').select('key, value');
  if (error) throw error;
  const map: Record<string, string> = {};
  for (const row of data ?? []) {
    map[row.key] = row.value;
  }
  return map;
}

export async function saveSetting(key: string, value: string): Promise<void> {
  const { error } = await supabase.from('app_settings').upsert({ key, value, updated_at: new Date().toISOString() });
  if (error) throw error;
}

// ---- Profile ----

export async function loadProfile(userId: string): Promise<{ id: string; full_name: string; email: string; role: string; site_id: string | null } | null> {
  const { data, error } = await supabase.from('profiles').select('id, full_name, email, role, site_id').eq('id', userId).maybeSingle();
  if (error) throw error;
  return data as { id: string; full_name: string; email: string; role: string; site_id: string | null } | null;
}

// ---- Customer Search (autocomplete) ----

export async function searchCustomers(query: string): Promise<Customer[]> {
  const { data, error } = await supabase
    .from('customers')
    .select('id, full_name, phone, email, total_spent, visits, loyalty_points, created_at')
    .ilike('full_name', `%${query}%`)
    .order('full_name')
    .limit(10);
  if (error) throw error;
  return (data ?? []) as Customer[];
}

// ---- Create Customer with Vehicle ----

export async function createCustomerWithVehicle(input: {
  full_name: string;
  phone: string;
  email?: string;
  plate_number?: string;
  brand?: string;
  model?: string;
  color?: string;
  vehicle_type?: string;
}): Promise<Customer> {
  const { data: customer, error: custError } = await supabase
    .from('customers')
    .insert({ full_name: input.full_name, phone: input.phone, email: input.email || null })
    .select('id, full_name, phone, email, total_spent, visits, loyalty_points, created_at')
    .maybeSingle();
  if (custError) throw custError;
  if (!customer) throw new Error("Le client n'a pas pu être enregistré.");

  if (input.plate_number || input.brand || input.model) {
    const { error: vehError } = await supabase.from('vehicles').insert({
      customer_id: customer.id,
      plate_number: input.plate_number || '',
      brand: input.brand || '',
      model: input.model || '',
      color: input.color || '',
      vehicle_type: input.vehicle_type || 'Berline',
    });
    if (vehError) throw vehError;
  }

  return customer as Customer;
}

// ---- Update Service ----

export async function updateService(id: string, input: { name: string; category: string; price_usd: number; price_cdf: number; duration_minutes: number }): Promise<void> {
  const { error } = await supabase.from('services').update(input).eq('id', id);
  if (error) throw error;
}

// ---- Loyalty: check if 5th visit (free) ----

export async function checkLoyaltyFreeVisit(customerName: string): Promise<{ isFree: boolean; visitCount: number }> {
  const { data, error } = await supabase
    .from('customers')
    .select('id, visits')
    .ilike('full_name', customerName)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return { isFree: false, visitCount: 0 };
  const visitCount = (data.visits as number) + 1;
  return { isFree: visitCount % 5 === 0, visitCount };
}

// ---- Increment customer visits ----

export async function incrementCustomerVisits(customerName: string): Promise<void> {
  const { data: customer, error: findError } = await supabase
    .from('customers')
    .select('id, visits, loyalty_points')
    .ilike('full_name', customerName)
    .limit(1)
    .maybeSingle();
  if (findError || !customer) return;
  const newVisits = (customer.visits as number) + 1;
  const newPoints = (customer.loyalty_points as number) + 10;
  await supabase.from('customers').update({ visits: newVisits, loyalty_points: newPoints, total_spent: customer.total_spent }).eq('id', customer.id);
}
