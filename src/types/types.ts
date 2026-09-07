export type Role = 'owner' | 'admin' | 'manager' | 'cashier' | 'operator' | 'stock_manager';
export type Page = 'dashboard' | 'orders' | 'queue' | 'customers' | 'services' | 'cash' | 'inventory' | 'expenses' | 'employees' | 'subscriptions' | 'appointments' | 'complaints' | 'notifications' | 'audit' | 'reports' | 'settings' | 'users';

export type UserAccount = {
  id: string;
  email: string;
  full_name: string;
  role: Role;
  created_at: string;
};

export type AppSetting = {
  key: string;
  value: string;
};

export type Site = {
  id: string;
  name: string;
  address: string;
  phone: string;
  is_active: boolean;
};

export type AuditLog = {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  details: Record<string, unknown>;
  created_at: string;
};

export type OrderItem = {
  id: string;
  service_name: string;
  quantity: number;
  unit_price_usd: number;
};

export type Profile = {
  id: string;
  full_name: string;
  email: string;
  role: Role;
  site_id?: string | null;
};

export type Service = {
  id: string;
  name: string;
  category: string;
  price_usd: number;
  price_cdf: number;
  duration_minutes: number;
  is_active: boolean;
};

export type Subscription = {
  id: string;
  customer_id: string;
  name: string;
  price_usd: number;
  allowed_washes: number | null;
  used_washes: number;
  starts_at: string;
  expires_at: string;
  status: string;
};

export type Appointment = {
  id: string;
  customer_name: string;
  vehicle_label: string;
  service_name: string;
  starts_at: string;
  status: string;
};

export type Complaint = {
  id: string;
  case_number: string;
  customer_name: string;
  subject: string;
  priority: string;
  status: string;
  created_at: string;
};

export type AppNotification = {
  id: string;
  title: string;
  message: string;
  category: string;
  is_read: boolean;
  created_at: string;
};

export type Customer = {
  id: string;
  full_name: string;
  phone: string;
  email: string | null;
  total_spent: number;
  visits: number;
  loyalty_points: number;
  vehicle_label?: string;
  created_at: string;
};

export type Vehicle = {
  id: string;
  customer_id: string | null;
  plate_number: string;
  brand: string;
  model: string;
  color: string;
  vehicle_type: string;
};

export type Product = {
  id: string;
  name: string;
  category: string;
  unit: string;
  current_stock: number;
  minimum_stock: number;
  unit_cost: number;
};

export type Expense = {
  id: string;
  category: string;
  description: string;
  amount: number;
  currency: string;
  status: string;
  created_at: string;
};

export type Employee = {
  id: string;
  full_name: string;
  role: string;
  phone: string;
  is_active: boolean;
  created_at: string;
};

export type CashRegister = {
  id: string;
  opening_usd: number;
  opening_cdf: number;
  closing_usd: number | null;
  closing_cdf: number | null;
  status: string;
  opened_at: string;
  closed_at: string | null;
};

export type CashMovement = {
  id: string;
  cash_register_id: string;
  type: string;
  amount: number;
  currency: string;
  reason: string;
  created_at: string;
};

export type Order = {
  id: string;
  order_number: string;
  customer_name: string;
  vehicle_label: string;
  total_usd: number;
  paid_usd: number;
  payment_method: string;
  status: string;
  assigned_employee?: string | null;
  arrived_at: string;
  created_at: string;
  personal_items?: string | null;
  vehicle_details?: string | null;
  is_free_visit?: boolean;
};

export type MobileMoneyProvider = 'airtel_money' | 'm_pesa' | 'orange_money';

export type MobileMoneyPayment = {
  provider: MobileMoneyProvider;
  phone_number: string;
  amount: number;
  reference?: string;
};
