# Visión de producto

> Estado: **borrador Fase 0** — pendiente de validación con los dueños de la fábrica.
> Todo lo que no figure como "confirmado" es una hipótesis de trabajo.

## 1. Problema

Una PyME argentina que fabrica y vende ropa para bebés tiene que coordinar compras de insumos, corte, confección interna y en talleres externos, ventas mayoristas por curva de talles y colores, cuentas corrientes y una operatoria financiera con mucho cheque diferido.

Los sistemas de gestión generalistas, como el que usa hoy la empresa (SISAGO), cubren bien la facturación, las ventas, las compras, el stock, la tesorería y los gastos. En cambio, tratan la producción como un módulo "a medida" y no modelan:

- las **variantes** de talle y color como una matriz de trabajo diaria;
- la **ficha técnica** (lista de materiales) con consumos por talle y versiones;
- la **mercadería en poder de talleres** y la liquidación de sus servicios;
- el **costo real** de cada orden de producción;
- el **ciclo de vida completo del cheque de terceros** (cartera → endoso → rechazo → recupero);
- la diferencia entre **plata facturada, cobrada y disponible**.

El resultado típico es usar planillas paralelas, cargar datos dos veces y no saber con certeza cuánto cuesta cada prenda ni cuánto dinero hay realmente.

## 2. Propuesta

Un ERP web, en español argentino y pensado para la industria de la indumentaria, que sea el **centro operativo único** de la empresa:

1. **Un solo dato, una sola carga.** El pedido reserva stock, el remito lo descuenta, la factura genera la deuda y el recibo la cancela. No se vuelve a tipear nada.
2. **Todo es un movimiento.** Stock, cuentas corrientes, caja y cheques se calculan a partir de movimientos inmutables. Ningún saldo se edita a mano.
3. **La grilla de talles y colores es la interfaz principal.** Sirve para cargar pedidos, órdenes de producción, conteos y precios.
4. **Producción con costo real.** La orden toma una versión congelada de la ficha técnica, registra los consumos reales, las mermas y los servicios de taller, y llega al costo unitario real.
5. **Finanzas honestas.** Se separa lo facturado, lo cobrado, lo acreditado y el resultado. Un cheque diferido nunca cuenta como efectivo.
6. **Configurable.** Etapas de producción, estados, numeraciones, listas de precios, aprobaciones y unidades se configuran sin tocar código.

## 3. Usuarios y lo que necesita cada uno

| Rol | Necesita… | Métrica de éxito |
|---|---|---|
| Dueños / Dirección | Entender el negocio en 10 segundos y profundizar cuando haga falta | Abren el tablero a diario y dejan de pedir planillas |
| Administración | Registrar compras, facturas, cobros y pagos con pocos pasos | Cargar una factura de proveedor con OC en menos de 1 minuto |
| Ventas | Cargar un pedido mayorista de muchas variantes rápido | Un pedido de 10 modelos × 5 talles × 4 colores en menos de 3 minutos |
| Producción / operarios | Ver sus órdenes e informar avances sin formularios | Informar un avance en 3 toques o menos desde el celular |
| Depósito | Recibir, preparar, transferir y contar con lector de código de barras | Cero ajustes de stock sin motivo |
| Tesorería | Controlar caja, bancos y cheques y proyectar fondos | Conciliación bancaria mensual en menos de 1 hora |

## 4. Principios de diseño

- **El sistema se adapta a la empresa.** Si un proceso no aplica (por ejemplo, no se usan talleres externos o no hay venta minorista), se desactiva y no aparece en pantalla.
- **Circuitos completos y circuitos cortos.** Toda cadena larga, como solicitud → cotización → OC → recepción → factura, tiene un atajo para el caso simple, como "compra directa con factura".
- **Reversa antes que borrado.** En lo financiero y de inventario nada se elimina: se anula con un documento que deja rastro.
- **El backend es la autoridad.** Permisos, validaciones e invariantes viven en el servidor.
- **Estimado ≠ real ≠ contable.** Cada número dice qué es.

## 5. Qué no es (por ahora)

- No es un sistema contable completo, con libro diario y balance. Exporta la información que necesita el estudio contable y deja preparado el asiento automático para una etapa posterior.
- No es una tienda online. Puede integrarse a futuro con una.
- No reemplaza a la facturación electrónica homologada mientras la integración con ARCA no esté probada en homologación y en producción.

## 6. Horizonte SaaS

La prioridad es que funcione impecable para esta PyME. Igual, desde el día 1 el modelo de datos es **multiempresa** (`company_id` en cada tabla, más Row-Level Security en PostgreSQL), para que comercializarlo después no exija reescribirlo.

## 7. Referencia de mercado: SISAGO

Según su sitio público (consultado el 28/10/2026), SISAGO ofrece facturación electrónica con ARCA, ventas, compras con estado de cuenta de proveedores, stock, tesorería, gastos, reportes, listas de precios múltiples, multidepósito, multimoneda e integración con Mercado Pago e impresora térmica. Producción, vendedores, presupuestos e importaciones masivas aparecen como módulos de un plan "Personalizado".

Lo usamos **solo como referencia** del mínimo funcional que la empresa ya tiene. No sabemos qué módulos usa efectivamente el cliente: es una de las preguntas abiertas.
