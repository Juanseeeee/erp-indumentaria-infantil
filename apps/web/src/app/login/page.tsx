'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { LoginInput, LoginSchema } from '@erp/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { Button, Card, Field, Input } from '@/components/ui';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<LoginInput>({ resolver: zodResolver(LoginSchema) });

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      await api.post('/auth/login', values);
      qc.clear();
      const next = params.get('next');
      router.replace(next && next.startsWith('/') && !next.startsWith('//') ? next : '/');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo conectar con el servidor.');
    }
  });

  return (
    <Card className="w-full max-w-sm p-6">
      <h1 className="text-lg font-semibold">Ingresar</h1>
      <p className="mt-1 text-sm text-muted">ERP de gestión para indumentaria infantil</p>
      <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4" noValidate>
        <Field label="Email" htmlFor="email" error={formState.errors.email?.message}>
          <Input id="email" type="email" autoComplete="username" autoFocus aria-invalid={!!formState.errors.email} {...register('email')} />
        </Field>
        <Field label="Contraseña" htmlFor="password" error={formState.errors.password?.message}>
          <Input id="password" type="password" autoComplete="current-password" aria-invalid={!!formState.errors.password} {...register('password')} />
        </Field>
        {error && (
          <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}
        <Button type="submit" loading={formState.isSubmitting}>
          Ingresar
        </Button>
      </form>
    </Card>
  );
}

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}
