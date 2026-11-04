'use client';

import { useQuery } from '@tanstack/react-query';
import type { PermissionCode } from '@erp/contracts';
import type { ReactNode } from 'react';
import { api } from './api';

export interface Me {
  user: { id: string; email: string; name: string };
  company: { id: string; legalName: string; tradeName: string | null };
  roles: { code: string; name: string }[];
  permissions: string[];
}

export function useMe() {
  return useQuery({ queryKey: ['me'], queryFn: () => api.get<Me>('/auth/me'), staleTime: 60_000 });
}

/** La UI solo oculta: la autorización real está en el backend. */
export function useCan() {
  const { data } = useMe();
  /** Con varios permisos, exige todos. */
  return (p: PermissionCode | PermissionCode[]) => [p].flat().every((code) => !!data?.permissions.includes(code));
}

export function Can({ perm, children, fallback = null }: { perm: PermissionCode; children: ReactNode; fallback?: ReactNode }) {
  const can = useCan();
  return <>{can(perm) ? children : fallback}</>;
}

export interface MasterData {
  uoms: { id: string; code: string; name: string; dimension: string; isActive: boolean }[];
  conversions: { id: string; fromUomId: string; toUomId: string; factor: string; itemId: string | null }[];
  colors: { id: string; code: string; name: string; hex: string | null; isActive: boolean }[];
  sizeScales: { id: string; name: string; sizes: { id: string; code: string; sortOrder: number }[] }[];
  categories: { id: string; name: string; kind: 'PRODUCT' | 'MATERIAL' | 'EXPENSE'; parentId: string | null }[];
  seasons: { id: string; name: string; year: number }[];
  collections: { id: string; name: string; seasonId: string }[];
  warehouses: { id: string; code: string; name: string; type: string; isActive: boolean; partyId: string | null }[];
  paymentTerms: { id: string; name: string; days: number[] }[];
  zones: { id: string; name: string }[];
  costCenters: { id: string; code: string; name: string; isActive: boolean }[];
}

export function useMasterData() {
  return useQuery({ queryKey: ['master-data'], queryFn: () => api.get<MasterData>('/settings/master-data'), staleTime: 5 * 60_000 });
}
