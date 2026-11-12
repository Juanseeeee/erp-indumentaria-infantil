import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { Client, createApp, createMaterial, createTenant, login, opening, Tenant } from './helpers';

/**
 * Asistente de IA contra un servidor falso con el protocolo de streaming de la API de Anthropic:
 * prueba el bucle de herramientas, el SSE hacia el navegador y que las consultas respeten permisos.
 */
type Turn = { text?: string; tool?: { name: string; input: object } };
let script: Turn[] = [];
const requests: Record<string, unknown>[] = [];

function sse(turn: Turn, n: number) {
  const ev = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
  let out = ev('message_start', {
    message: { id: `msg_${n}`, type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 1, cache_read_input_tokens: 0 } },
  });
  let i = 0;
  if (turn.text) {
    out += ev('content_block_start', { index: i, content_block: { type: 'text', text: '' } });
    for (const part of turn.text.match(/.{1,12}/gs)!) out += ev('content_block_delta', { index: i, delta: { type: 'text_delta', text: part } });
    out += ev('content_block_stop', { index: i++ });
  }
  if (turn.tool) {
    out += ev('content_block_start', { index: i, content_block: { type: 'tool_use', id: `toolu_${n}`, name: turn.tool.name, input: {} } });
    out += ev('content_block_delta', { index: i, delta: { type: 'input_json_delta', partial_json: JSON.stringify(turn.tool.input) } });
    out += ev('content_block_stop', { index: i++ });
  }
  out += ev('message_delta', { delta: { stop_reason: turn.tool ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 20 } });
  return out + ev('message_stop', {});
}

let mock: Server;
let app: INestApplication;
let t: Tenant;
let admin: Client;
let operator: Client;
const saved = { key: process.env.ANTHROPIC_API_KEY, url: process.env.ANTHROPIC_BASE_URL };

beforeAll(async () => {
  mock = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      requests.push(JSON.parse(body));
      const turn = script.shift() ?? { text: 'Listo.' };
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end(sse(turn, requests.length));
    });
  });
  await new Promise<void>((r) => mock.listen(0, '127.0.0.1', r));
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(mock.address() as AddressInfo).port}`;

  app = await createApp();
  t = await createTenant();
  admin = await login(app, t.users.SUPERADMIN);
  operator = await login(app, t.users.OPERATOR);
  const tela = await createMaterial(admin, t, 'INTERLOCK-CEL');
  await opening(admin, t.whA, [{ itemId: tela, qty: '120', unitCost: '3500' }]);
});

afterAll(async () => {
  await app?.close();
  mock?.close();
  process.env.ANTHROPIC_API_KEY = saved.key;
  process.env.ANTHROPIC_BASE_URL = saved.url;
});

/** Junta los eventos SSE de una respuesta. */
const events = (raw: string) =>
  raw
    .split('\n\n')
    .filter((c) => c.startsWith('data: '))
    .map((c) => JSON.parse(c.slice(6)) as { type: string; text?: string; label?: string; message?: string });

const ask = (c: Client, content: string) =>
  c.post('/assistant/chat', { messages: [{ role: 'user', content }], page: '/stock' }).buffer(true).parse((res, cb) => {
    let data = '';
    res.on('data', (d: Buffer) => (data += d.toString()));
    res.on('end', () => cb(null, data));
  });

describe('Asistente de IA', () => {
  it('informa que está habilitado', async () => {
    expect((await admin.get('/assistant/status').expect(200)).body).toEqual({ enabled: true, mode: 'claude' });
  });

  it('consulta stock con herramientas y transmite la respuesta', async () => {
    requests.length = 0;
    script = [{ text: 'Me fijo. ', tool: { name: 'consultar_stock', input: { texto: 'INTERLOCK' } } }, { text: 'Hay **120 m** de [interlock celeste](/materiales/x).' }];
    const res = await ask(admin, '¿Cuánto interlock celeste hay?').expect(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    const evs = events(res.body as string);
    expect(evs.find((e) => e.type === 'tool')?.label).toBe('Consultando stock');
    expect(evs.filter((e) => e.type === 'text').map((e) => e.text).join('')).toBe('Me fijo. Hay **120 m** de [interlock celeste](/materiales/x).');
    expect(evs.at(-1)!.type).toBe('done');

    // Primera llamada: guía cacheada + contexto del usuario, modelo y herramientas.
    const first = requests[0] as { model: string; system: { text: string; cache_control?: object }[]; tools: { name: string }[]; fallbacks: string };
    expect(first.model).toBe('claude-opus-5-5');
    expect(first.fallbacks).toBe('default');
    expect(first.system[0]!.cache_control).toEqual({ type: 'ephemeral' });
    expect(first.system[0]!.text).toContain('GUÍA DE LA PLATAFORMA');
    expect(first.system[0]!.text).toContain('Visión general de la plataforma');
    expect(first.system[1]!.text).toContain('Pantalla actual: /stock');
    expect(first.system[1]!.text).toContain('inventory.view');
    expect(first.tools.map((x) => x.name).sort()).toEqual(['buscar', 'consultar_documento', 'consultar_stock']);

    // Segunda llamada: el resultado real de la herramienta, con el stock del depósito.
    const second = requests[1] as { messages: { role: string; content: { type: string; content?: string }[] | string }[] };
    const result = (second.messages.at(-1)!.content as { type: string; content: string }[])[0]!;
    expect(result.type).toBe('tool_result');
    const items = JSON.parse(result.content) as { sku: string; fisico: number; disponible: number; porDeposito: unknown[] }[];
    expect(items[0]).toMatchObject({ sku: 'INTERLOCK-CEL', fisico: 120, disponible: 120 });
    expect(items[0]!.porDeposito).toHaveLength(1);
  });

  it('las consultas respetan los permisos del usuario', async () => {
    requests.length = 0;
    script = [{ tool: { name: 'consultar_stock', input: { texto: 'INTERLOCK' } } }, { text: 'No tenés permiso para ver stock.' }];
    await ask(operator, '¿Cuánto interlock hay?').expect(200);
    const second = requests[1] as { messages: { content: { content: string }[] }[] };
    expect(second.messages.at(-1)!.content[0]!.content).toContain('inventory.view');
    expect(second.messages.at(-1)!.content[0]!.content).not.toContain('INTERLOCK-CEL');
  });

  it('rechaza parámetros inválidos de una herramienta sin ejecutarla', async () => {
    requests.length = 0;
    script = [{ tool: { name: 'consultar_stock', input: { texto: 'x' } } }, { text: 'Necesito más detalle.' }];
    await ask(admin, 'stock').expect(200);
    const second = requests[1] as { messages: { content: { is_error?: boolean }[] }[] };
    expect(second.messages.at(-1)!.content[0]!.is_error).toBe(true);
  });

  it('valida la conversación', async () => {
    await admin.post('/assistant/chat', { messages: [{ role: 'assistant', content: 'hola' }] }).expect(400);
    await admin.post('/assistant/chat', { messages: [] }).expect(400);
  });
});
