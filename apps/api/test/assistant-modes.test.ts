import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { Client, createApp, createMaterial, createTenant, login, opening, Tenant } from './helpers';

/**
 * Motores gratuitos del asistente: Gemini (contra un servidor falso con el protocolo de streaming
 * de la API de Google) y el modo guía sin IA, que además es el respaldo cuando la IA falla.
 */
type GTurn = { text?: string; call?: { name: string; args: object }; status?: number };
let script: GTurn[] = [];
const requests: { url: string; body: Record<string, unknown> }[] = [];

let mock: Server;
let t: Tenant;
let gemini: INestApplication;
let guide: INestApplication;
let gAdmin: Client;
let guideAdmin: Client;
let guideOperator: Client;
let openingNumber: string;
const ENV = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'GEMINI_API_KEY', 'GEMINI_BASE_URL', 'ASSISTANT_PROVIDER', 'ASSISTANT_MODEL'] as const;
const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
const setEnv = (vars: Partial<Record<(typeof ENV)[number], string>>) => {
  for (const k of ENV) delete process.env[k];
  Object.assign(process.env, vars);
};

beforeAll(async () => {
  mock = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      requests.push({ url: req.url ?? '', body: JSON.parse(body) });
      const turn = script.shift() ?? { text: 'Listo.' };
      if (turn.status) {
        res.writeHead(turn.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { code: turn.status, message: 'Quota exceeded', status: 'RESOURCE_EXHAUSTED' } }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const chunk = (parts: object[], finish?: string) =>
        `data: ${JSON.stringify({ candidates: [{ content: { role: 'model', parts }, ...(finish ? { finishReason: finish } : {}) }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 5 } })}\r\n\r\n`;
      let out = '';
      if (turn.call) out += chunk([{ functionCall: { name: turn.call.name, args: turn.call.args }, thoughtSignature: 'firma-123' }], 'STOP');
      if (turn.text) {
        const parts = turn.text.match(/.{1,10}/gs)!;
        parts.forEach((p, i) => (out += chunk([{ text: p }], i === parts.length - 1 ? 'STOP' : undefined)));
      }
      res.end(out);
    });
  });
  await new Promise<void>((r) => mock.listen(0, '127.0.0.1', r));

  setEnv({ ASSISTANT_PROVIDER: 'gemini', GEMINI_API_KEY: 'gemini-test', GEMINI_BASE_URL: `http://127.0.0.1:${(mock.address() as AddressInfo).port}` });
  gemini = await createApp();
  setEnv({});
  guide = await createApp();

  t = await createTenant();
  gAdmin = await login(gemini, t.users.SUPERADMIN);
  guideAdmin = await login(guide, t.users.SUPERADMIN);
  guideOperator = await login(guide, t.users.OPERATOR);
  const tela = await createMaterial(gAdmin, t, 'INTERLOCK-CEL');
  openingNumber = (await opening(gAdmin, t.whA, [{ itemId: tela, qty: '120', unitCost: '3500' }])).body.number;
});

afterAll(async () => {
  await gemini?.close();
  await guide?.close();
  mock?.close();
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const events = (raw: string) =>
  raw
    .split('\n\n')
    .filter((c) => c.startsWith('data: '))
    .map((c) => JSON.parse(c.slice(6)) as { type: string; text?: string; label?: string; message?: string });
const textOf = (raw: string) => events(raw).filter((e) => e.type === 'text').map((e) => e.text).join('');

const ask = (c: Client, content: string, page = '/') =>
  c.post('/assistant/chat', { messages: [{ role: 'user', content }], page }).buffer(true).parse((res, cb) => {
    let data = '';
    res.on('data', (d: Buffer) => (data += d.toString()));
    res.on('end', () => cb(null, data));
  });

describe('Asistente con Gemini', () => {
  it('informa el modo', async () => {
    expect((await gAdmin.get('/assistant/status').expect(200)).body).toEqual({ enabled: true, mode: 'gemini' });
  });

  it('usa herramientas y devuelve el turno del modelo con su firma', async () => {
    requests.length = 0;
    script = [{ call: { name: 'consultar_stock', args: { texto: 'INTERLOCK' } } }, { text: 'Hay **120 m** disponibles.' }];
    const res = await ask(gAdmin, '¿Cuánto interlock hay?').expect(200);
    const evs = events(res.body as string);
    expect(evs.find((e) => e.type === 'tool')?.label).toBe('Consultando stock');
    expect(textOf(res.body as string)).toBe('Hay **120 m** disponibles.');
    expect(evs.at(-1)!.type).toBe('done');

    expect(requests[0]!.url).toContain('gemini-3.8-flash:streamGenerateContent');
    const first = requests[0]!.body as { systemInstruction: { parts: { text: string }[] }; tools: { functionDeclarations: { name: string }[] }[] };
    expect(first.systemInstruction.parts[0]!.text).toContain('GUÍA DE LA PLATAFORMA');
    expect(first.tools[0]!.functionDeclarations.map((f) => f.name).sort()).toEqual(['buscar', 'consultar_documento', 'consultar_stock']);

    const second = requests[1]!.body as { contents: { role: string; parts: { thoughtSignature?: string; functionResponse?: { name: string; response: { result: { sku: string; fisico: number }[] } } }[] }[] };
    const [model, reply] = second.contents.slice(-2);
    expect(model!.role).toBe('model');
    expect(model!.parts[0]!.thoughtSignature).toBe('firma-123');
    expect(reply!.parts[0]!.functionResponse!.name).toBe('consultar_stock');
    expect(reply!.parts[0]!.functionResponse!.response.result[0]).toMatchObject({ sku: 'INTERLOCK-CEL', fisico: 120 });
  });

  it('con el cupo gratuito agotado responde con la guía', async () => {
    script = [{ status: 429 }, { status: 429 }, { status: 429 }];
    const res = await ask(gAdmin, '¿Cómo facturo un remito?').expect(200);
    const text = textOf(res.body as string);
    expect(text).toContain('cupo gratuito');
    expect(text).toContain('Cómo facturar remitos');
    expect(events(res.body as string).at(-1)!.type).toBe('done');
  });
});

describe('Asistente en modo guía (sin IA)', () => {
  it('informa el modo', async () => {
    expect((await guideAdmin.get('/assistant/status').expect(200)).body).toEqual({ enabled: true, mode: 'guide' });
  });

  it('responde con la sección de la guía y sugiere otras', async () => {
    const text = textOf((await ask(guideAdmin, '¿Cómo hago un ajuste de stock?', '/stock').expect(200)).body as string);
    expect(text).toContain('**Cómo hacer un ajuste de stock**');
    expect(text).toContain('](#ask:');
    expect(text).toContain('Modo guía');
  });

  it('consulta stock y documentos por número con los permisos del usuario', async () => {
    const stock = textOf((await ask(guideAdmin, '¿Cuánto hay de INTERLOCK?').expect(200)).body as string);
    expect(stock).toContain('INTERLOCK-CEL');
    expect(stock).toContain('**120 m** disponibles');

    const doc = textOf((await ask(guideAdmin, `¿En qué estado está el ${openingNumber}?`).expect(200)).body as string);
    expect(doc).toContain(openingNumber);
    expect(doc).toContain('/stock/documentos/');

    const denied = textOf((await ask(guideOperator, `¿En qué estado está el ${openingNumber}?`).expect(200)).body as string);
    expect(denied).not.toContain('/stock/documentos/');
  });

  it('avisa cuando la guía no tiene nada', async () => {
    const text = textOf((await ask(guideAdmin, 'xyzzy plugh').expect(200)).body as string);
    expect(text).toContain('No encontré nada en la guía');
  });
});
