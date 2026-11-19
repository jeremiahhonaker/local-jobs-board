/** Typed client for the Local Jobs Board API. */

export interface Me {
  id: string;
  email: string;
  name: string | null;
  phone: string | null;
  isOwner: boolean;
}

export interface PublicJob {
  id: string;
  title: string;
  category: string;
  description: string;
  payCents: number;
  feeCents: number;
  workerCents: number;
  area: string;
  dateNeeded: string | null;
  status: string;
  createdAt: string;
  completedAt: string | null;
}

export interface PrivateJob extends PublicJob {
  posterName: string;
  posterPhone: string;
  posterEmail: string;
  claimerName: string | null;
  claimerPhone: string | null;
  claimerEmail: string | null;
  isPoster: boolean;
  isClaimer: boolean;
}

export interface ContactInput {
  name: string;
  phone?: string;
  email?: string;
}

export interface CreateJobInput {
  title: string;
  category: string;
  description?: string;
  pay: number;
  area: string;
  dateNeeded?: string | null;
  contact: ContactInput;
}

export interface MyEarnings {
  asWorker: { jobsCompleted: number; totalPayCents: number; totalFeeCents: number };
  asPoster: { jobsCompleted: number; totalSpentCents: number };
}

export interface OwnerEarnings {
  jobsCompleted: number;
  totalPayCents: number;
  totalFeeCents: number;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const data = (await res.json().catch(() => null)) as { error?: string } | null;
  if (!res.ok) {
    throw new ApiError(res.status, data?.error ?? `Request failed (${res.status})`);
  }
  return data as T;
}

export const api = {
  me: () => request<{ user: Me | null }>("/api/me"),
  requestMagicLink: (email: string) =>
    request<{ ok: boolean; devLink?: string }>("/api/auth/magic-link", {
      method: "POST",
      body: JSON.stringify({ email }),
    }),
  logout: () => request<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),

  listJobs: (category?: string) =>
    request<{ jobs: PublicJob[] }>(
      category ? `/api/jobs?category=${encodeURIComponent(category)}` : "/api/jobs",
    ),
  getJob: (id: string) => request<{ job: PublicJob | PrivateJob }>(`/api/jobs/${id}`),
  createJob: (input: CreateJobInput) =>
    request<{ job: PrivateJob }>("/api/jobs", { method: "POST", body: JSON.stringify(input) }),
  claimJob: (id: string, contact: ContactInput) =>
    request<{ job: PrivateJob }>(`/api/jobs/${id}/claim`, {
      method: "POST",
      body: JSON.stringify({ contact }),
    }),
  unclaimJob: (id: string) =>
    request<{ job: PublicJob }>(`/api/jobs/${id}/unclaim`, { method: "POST" }),
  completeJob: (id: string) =>
    request<{ job: PrivateJob }>(`/api/jobs/${id}/complete`, { method: "POST" }),
  cancelJob: (id: string) =>
    request<{ job: PrivateJob }>(`/api/jobs/${id}/cancel`, { method: "POST" }),

  activity: () => request<{ posted: PrivateJob[]; claimed: PrivateJob[] }>("/api/my/activity"),
  myEarnings: () => request<MyEarnings>("/api/my/earnings"),
  ownerEarnings: () => request<OwnerEarnings>("/api/owner/earnings"),
};

export const CATEGORIES: { value: string; label: string }[] = [
  { value: "yard-work", label: "Yard Work" },
  { value: "moving-help", label: "Moving Help" },
  { value: "cleaning", label: "Cleaning" },
  { value: "hauling", label: "Hauling" },
  { value: "handyman", label: "Handyman" },
  { value: "errands", label: "Errands" },
];

export function categoryLabel(value: string): string {
  return CATEGORIES.find((c) => c.value === value)?.label ?? value;
}

/** "$60" for whole dollars, "$60.50" otherwise. */
export function fmtMoney(cents: number): string {
  const dollars = cents / 100;
  return Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`;
}

export function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
