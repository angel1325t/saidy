export type SectionId =
  | 'home'
  | 'catalog'
  | 'circulation'
  | 'my-library'
  | 'digital'
  | 'reports'
  | 'operations'
  | 'rbac'
  | 'admin';

export type ThemeMode = 'light' | 'dark';

export type RoleKey = 'ADMIN' | 'BIBLIOTECARIO' | 'DOCENTE' | 'INVESTIGADOR' | 'ESTUDIANTE';

export type Role = {
  id: string;
  key: RoleKey;
  name: string;
  description: string | null;
};

export type Permission = {
  id: string;
  key: string;
  name: string;
  description: string | null;
};

export type Profile = {
  id: string;
  email: string;
  full_name: string;
  member_type: 'public' | 'student' | 'teacher' | 'researcher' | 'staff';
  blocked_until: string | null;
  can_access_digital: boolean;
  loan_limit: number;
  reservation_limit: number;
  institution: string | null;
  department: string | null;
  bio: string | null;
  avatar_url: string | null;
  phone: string | null;
  preferred_language: string;
  roles: Role[];
  permissions: Permission[];
};

export type Material = {
  id: string;
  kind: string;
  title: string;
  subtitle: string | null;
  summary: string | null;
  publisher: string | null;
  publication_year: number | null;
  language: string | null;
  isbn: string | null;
  doi: string | null;
  cover_url: string | null;
  digital_url: string | null;
  keywords: string[] | null;
  created_at: string;
};

export type Overview = {
  materials: number;
  copies: number;
  loans: number;
  reservations: number;
};

export type Loan = {
  id: string;
  status: string;
  borrowed_at: string;
  due_at: string;
  returned_at: string | null;
  materials: { id: string; title: string; kind: string; cover_url: string | null };
  material_copies: {
    id: string;
    barcode: string | null;
    copy_code: string | null;
    status: string;
    location: string | null;
  } | null;
};

export type Reservation = {
  id: string;
  status: string;
  reserved_at: string;
  queue_position: number;
  materials: { id: string; title: string; kind: string; cover_url: string | null };
};

export type Fine = {
  id: string;
  amount: number;
  currency: string;
  status: string;
  reason: string | null;
  issued_at: string;
  due_at: string | null;
  paid_at: string | null;
  loans: { id: string; material_id: string | null; status: string; due_at: string } | null;
};

export type DigitalAsset = {
  id: string;
  access_url: string;
  expires_at: string | null;
  asset_type: string;
  materials: { id: string; title: string; kind: string; cover_url: string | null };
};

export type AdminDashboard = {
  materials: number;
  loans: number;
  reservations: number;
  fines: number;
  inventory: number;
  acquisitions: number;
  interlibrary: number;
  notifications: number;
};

export type PortalData = {
  profile: Profile | null;
  overview: Overview | null;
  materials: Material[];
  loans: Loan[];
  reservations: Reservation[];
  fines: Fine[];
  digitalAssets: DigitalAsset[];
  dashboard: AdminDashboard | null;
};
