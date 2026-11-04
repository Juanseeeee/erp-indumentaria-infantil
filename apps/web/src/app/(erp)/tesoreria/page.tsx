'use client';

import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Landmark, Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { fmtDate, fmtMoney, todayISO } from '@/lib/format';
import { Can } from '@/lib/session';
import { Badge, Button, Card, EmptyState, ErrorBox, Field, Input, PageHeader, Select, Tabs } from '@/components/ui';
import { ChequePortfolio } from './cheques';
import { Transfers } from './transferencias';
import { CashClosings } from './arqueos';
import { Reconciliation } from './conciliacion';

interface CashAccount {
  id: string;
  name: string;
  type: string;
  bank: string | null;
  currency: string;
  isActive: boolean;
  operationBalance: string;
  valueBalance: string;
}

interface TreasuryMovement {
  id: string;
  direction: 'IN' | 'OUT';
  amount: string;
  operationDate: string;
  valueDate: string;
  concept: string;
  paymentMethod: string | null;
  reconciled: boolean;
}

const ACCOUNT_TYPES: Record<string, string> = {
  CASH_BOX: 'Caja',
  BANK: 'Banco',
  WALLET: 'Billetera',
  CARD_CLEARING: 'Tarjetas a acreditar',
  CHEQUE_PORTFOLIO: 'Cartera de cheques',
};

export default function TreasuryPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState('cuentas');
  const [selectedId, setSelectedId] = useState('');
  const [accountName, setAccountName] = useState('');
  const [accountType, setAccountType] = useState('CASH_BOX');
  const [bank, setBank] = useState('');
  const [movementDirection, setMovementDirection] = useState<'IN' | 'OUT'>('IN');
  const [amount, setAmount] = useState('');
  const [concept, setConcept] = useState('');
  const [operationDate, setOperationDate] = useState(todayISO());

  const accountsQuery = useQuery({
    queryKey: ['treasury-accounts'],
    queryFn: () => api.get<CashAccount[]>('/treasury/accounts'),
  });
  const accounts = accountsQuery.data ?? [];
  const activeId = accounts.some((account) => account.id === selectedId && account.isActive)
    ? selectedId
    : accounts.find((account) => account.isActive)?.id ?? '';
  const movementsQuery = useQuery({
    queryKey: ['treasury-movements', activeId],
    queryFn: () => api.get<{ total: number; rows: TreasuryMovement[] }>(`/treasury/accounts/${activeId}/movements`),
    enabled: Boolean(activeId),
  });

  const createAccount = useMutation({
    mutationFn: () => api.post<CashAccount>('/treasury/accounts', { name: accountName, type: accountType, bank: bank || null }),
    onSuccess: async (account) => {
      setAccountName('');
      setBank('');
      setSelectedId(account.id);
      await queryClient.invalidateQueries({ queryKey: ['treasury-accounts'] });
    },
  });
  const createMovement = useMutation({
    mutationFn: () =>
      api.post(`/treasury/accounts/${activeId}/movements`, {
        direction: movementDirection,
        amount,
        concept,
        operationDate,
      }),
    onSuccess: async () => {
      setAmount('');
      setConcept('');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['treasury-accounts'] }),
        queryClient.invalidateQueries({ queryKey: ['treasury-movements', activeId] }),
      ]);
    },
  });

  function submitAccount(event: FormEvent) {
    event.preventDefault();
    createAccount.mutate();
  }

  function submitMovement(event: FormEvent) {
    event.preventDefault();
    createMovement.mutate();
  }

  return (
    <div>
      <PageHeader title="Tesorería" description="Cajas, bancos y cartera de cheques, con saldos por fecha de operación y fecha de valor. Transferencias entre cuentas y arqueos de caja." />
      <Tabs
        tabs={[
          { id: 'cuentas', label: 'Cuentas' },
          { id: 'cheques', label: 'Cartera de cheques' },
          { id: 'transferencias', label: 'Transferencias' },
          { id: 'arqueos', label: 'Arqueos' },
          { id: 'conciliacion', label: 'Conciliación' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'cheques' ? (
        <ChequePortfolio banks={accounts} />
      ) : tab === 'transferencias' ? (
        <Transfers accounts={accounts} />
      ) : tab === 'arqueos' ? (
        <CashClosings accounts={accounts} />
      ) : tab === 'conciliacion' ? (
        <Reconciliation accounts={accounts} />
      ) : (
        <>
          {accountsQuery.error && <ErrorBox error={accountsQuery.error} />}
          {createAccount.error && <ErrorBox error={createAccount.error} />}
          {createMovement.error && <ErrorBox error={createMovement.error} />}

          <div className="mb-6 grid gap-4 lg:grid-cols-2">
            <Can perm="treasury.accounts.manage">
              <Card className="p-4">
                <h2 className="mb-3 font-medium">Nueva cuenta</h2>
                <form className="grid gap-3 sm:grid-cols-2" onSubmit={submitAccount}>
                  <Field label="Nombre">
                    <Input required maxLength={100} value={accountName} onChange={(event) => setAccountName(event.target.value)} />
                  </Field>
                  <Field label="Tipo">
                    <Select value={accountType} onChange={(event) => setAccountType(event.target.value)}>
                      {Object.entries(ACCOUNT_TYPES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </Select>
                  </Field>
                  {accountType === 'BANK' && (
                    <Field label="Banco" className="sm:col-span-2">
                      <Input maxLength={100} value={bank} onChange={(event) => setBank(event.target.value)} />
                    </Field>
                  )}
                  <div className="sm:col-span-2">
                    <Button type="submit" loading={createAccount.isPending}><Plus className="size-4" /> Crear cuenta</Button>
                  </div>
                </form>
              </Card>
            </Can>
            <Can perm="treasury.move">
              <Card className="p-4">
                <h2 className="mb-3 font-medium">Registrar movimiento</h2>
                {!activeId ? (
                  <p className="text-sm text-muted">Creá una cuenta para empezar a registrar movimientos.</p>
                ) : (
                  <form className="grid gap-3 sm:grid-cols-2" onSubmit={submitMovement}>
                    <Field label="Cuenta">
                      <Select value={activeId} onChange={(event) => setSelectedId(event.target.value)}>
                        {accounts.filter((account) => account.isActive).map((account) => (
                          <option key={account.id} value={account.id}>{account.name}</option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Tipo">
                      <Select value={movementDirection} onChange={(event) => setMovementDirection(event.target.value as 'IN' | 'OUT')}>
                        <option value="IN">Ingreso</option>
                        <option value="OUT">Egreso</option>
                      </Select>
                    </Field>
                    <Field label="Importe">
                      <Input required inputMode="decimal" min="0.01" step="0.01" type="number" value={amount} onChange={(event) => setAmount(event.target.value)} />
                    </Field>
                    <Field label="Fecha de operación">
                      <Input required type="date" value={operationDate} onChange={(event) => setOperationDate(event.target.value)} />
                    </Field>
                    <Field label="Concepto" className="sm:col-span-2">
                      <Input required maxLength={300} value={concept} onChange={(event) => setConcept(event.target.value)} />
                    </Field>
                    <div className="sm:col-span-2">
                      <Button type="submit" loading={createMovement.isPending}>Guardar movimiento</Button>
                    </div>
                  </form>
                )}
              </Card>
            </Can>
          </div>

          <h2 className="mb-3 font-medium">Cuentas</h2>
          {accounts.length ? (
            <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {accounts.map((account) => (
                <button
                  key={account.id}
                  type="button"
                  onClick={() => setSelectedId(account.id)}
                  className={`rounded-lg border bg-surface p-4 text-left ${activeId === account.id ? 'border-accent' : 'border-border'}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 font-medium"><Landmark className="size-4 text-muted" />{account.name}</div>
                    {!account.isActive && <Badge>Inactiva</Badge>}
                  </div>
                  <p className="mt-1 text-sm text-muted">{ACCOUNT_TYPES[account.type] ?? account.type}{account.bank ? ` · ${account.bank}` : ''}</p>
                  <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                    <div><p className="text-muted">Operación</p><p className="num font-medium">{fmtMoney(account.operationBalance)}</p></div>
                    <div><p className="text-muted">Valor</p><p className="num font-medium">{fmtMoney(account.valueBalance)}</p></div>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <Card className="mb-6">
              <EmptyState icon={<Landmark className="size-8" />} title="Sin cuentas de tesorería" description="Creá una caja o cuenta bancaria para empezar a registrar los fondos." />
            </Card>
          )}

          {activeId && (
            <>
              <h2 className="mb-3 font-medium">Movimientos recientes</h2>
              {movementsQuery.error && <ErrorBox error={movementsQuery.error} />}
              <Card className="overflow-hidden">
                {movementsQuery.data?.rows.length ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="border-b border-border bg-surface-2 text-left text-muted">
                        <tr><th className="px-3 py-2">Fecha</th><th className="px-3 py-2">Concepto</th><th className="px-3 py-2">Valor</th><th className="px-3 py-2 text-right">Importe</th></tr>
                      </thead>
                      <tbody>
                        {movementsQuery.data.rows.map((movement) => (
                          <tr key={movement.id} className="border-b border-border last:border-0">
                            <td className="px-3 py-2">{fmtDate(movement.operationDate)}</td>
                            <td className="px-3 py-2">
                              {movement.concept}
                              {movement.reconciled && <span className="ml-2"><Badge tone="success">Conciliado</Badge></span>}
                            </td>
                            <td className="px-3 py-2">{fmtDate(movement.valueDate)}</td>
                            <td className={`num px-3 py-2 text-right ${movement.direction === 'OUT' ? 'text-danger' : 'text-success'}`}>
                              {movement.direction === 'OUT' ? '−' : '+'}{fmtMoney(movement.amount)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <EmptyState title="Sin movimientos" description="Los ingresos y egresos de esta cuenta aparecerán aquí." />
                )}
              </Card>
            </>
          )}
        </>
      )}
    </div>
  );
}
