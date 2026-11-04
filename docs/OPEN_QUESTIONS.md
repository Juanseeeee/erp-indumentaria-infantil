# Preguntas abiertas

> Para responder con los dueños de la fábrica (y algunas con el contador).
> **Versión para el cliente** (lenguaje no técnico, con columna para responder): https://claude.ai/artifact/PcHge5qQUoKaRUotkU2Khx. Al agregar una pregunta acá, agregarla también allá.
> 🔴 = bloquea decisiones de diseño difíciles de revertir · 🟡 = afecta el alcance · 🟢 = puede definirse más adelante.

## A. Empresa y operación general

1. 🔴 ¿Cuántas personas usarían el sistema y en qué roles? ¿Quién cumple más de un rol?
2. 🔴 ¿Hay más de una razón social o CUIT (por ejemplo, fábrica y comercializadora)? ¿Más de una sucursal o local?
3. 🟡 ¿Cuántos depósitos físicos hay? ¿Producto terminado y materia prima están en el mismo lugar?
4. 🟡 ¿Qué volumen manejan? Modelos activos por temporada, SKU totales, pedidos por mes, facturas por mes, cheques por mes.
5. 🟡 ¿Qué módulos de SISAGO usan hoy y qué les gusta y qué no? ¿Qué llevan en planillas fuera del sistema?
6. 🟢 ¿Trabajan por temporadas o colecciones (OI, PV)? ¿Cuándo empieza cada una y cómo se planifica?

## B. Productos y catálogo

7. 🔴 ¿Qué escala de talles usan? (RN, 0-3, 3-6… ¿hay talles 1, 2, 3 para niños?) ¿Todos los modelos usan la misma?
8. 🟡 ¿Cómo codifican hoy los productos? ¿Tienen códigos de barras? ¿Quieren mantener los códigos actuales?
9. 🟡 ¿Un mismo modelo puede tener precio distinto según el talle?
10. 🟢 ¿Venden *packs* o kits (por ejemplo, ajuar de 3 piezas)? ¿Se arman en stock o al vender?
11. 🟢 ¿Hay estampados o bordados como variante adicional al color?

## C. Producción

12. 🔴 Describan el recorrido real de una prenda desde la tela hasta el depósito. ¿Qué etapas son internas y cuáles externas?
13. 🔴 ¿El corte se hace internamente? ¿Se corta por **tizada** (varios talles y colores juntos en un tendido) o por prenda? Esto cambia el cálculo de consumo.
14. 🔴 ¿Los talleres reciben **tela** o **piezas cortadas**? ¿Les dan avíos (broches, etiquetas)? ¿Los talleres compran algo por su cuenta?
15. ✅ ~~¿Cómo se paga a los talleres?~~ **Respondida (28/10/2026): el taller cotiza por prenda terminada, con un precio por modelo (p. ej. body $X, manta $Y).** Pendiente: ¿se descuentan fallas y faltantes?
16. 🟡 ¿Tienen hoy fichas técnicas con consumos? ¿Quién las mantiene? ¿Qué precisión tienen?
16b. 🟡 ¿Cómo reparten hoy los gastos indirectos (luz, alquiler, sueldos de planta) en el costo de cada prenda?
17. 🟡 ¿Dónde se hace el control de calidad, en la recepción del taller, al final o en ambos? ¿Qué se hace con la segunda selección: se vende, se descarta, se reprocesa?
18. 🟡 ¿Producen contra pedido, para stock o mixto?
19. 🟢 ¿Les interesa medir los tiempos y la productividad de operarios internos?
20. 🟢 ¿Usan tintorería, estampería o bordado tercerizados como etapa externa?

## D. Compras e insumos

21. 🟡 ¿La tela se compra por kilo o por metro? ¿Se controla rollo por rollo o por partida de color?
22. 🟡 ¿Quién aprueba las compras? ¿Hay montos que requieran autorización?
23. 🟢 ¿Piden cotizaciones a varios proveedores o compran siempre al mismo?
24. 🟢 ¿Importan insumos (moneda extranjera, despachos)?

## E. Ventas

25. 🔴 Canales: ¿mayorista a locales, distribuidores, minorista en local propio, venta online, marketplaces?
26. 🔴 ¿Se factura al despachar cada remito o se agrupan varios remitos en una factura? **Sin definir (29/10/2026): el sistema soporta ambas formas (Fase 3).**
27. 🟡 ¿Cuántas listas de precios hay? ¿Los precios incluyen IVA? ¿Con qué frecuencia y cómo se actualizan?
28. 🟡 ¿Venden por curva o pack de talles obligatorio, o por unidad suelta? ¿Mínimos de compra?
29. ✅ ~~¿Hay vendedores con comisión?~~ **Respondida (28/10/2026): sueldo fijo + comisiones.** **La comisión se calcula sobre lo cobrado (29/10/2026).** Pendiente: ¿% único o variable? ¿con o sin IVA y retenciones? ¿cheque: al recibir o al acreditar, y qué pasa si rebota?
30. 🟡 ¿Cómo se manejan los faltantes de un pedido: se envía lo que hay y se cancela el resto, o queda pendiente?
31. 🟢 ¿Hay límite de crédito por cliente hoy? ¿Qué pasa si se excede?
32. 🟢 Políticas de devolución y cambio de talle.

### Surgidas en la Fase 3
- 29b. 🟡 ¿Cuál es el descuento máximo que puede dar un vendedor sin autorización? (hoy 15 %, configurable)
- 29c. 🔴 ¿Qué punto de venta electrónico usan para facturar? ¿Quién puede generar el certificado de ARCA con clave fiscal para homologar?
- 29d. 🟡 ¿Los remitos que emiten hoy llevan CAI o código de operación de traslado (COT de ARBA)?
- 29e. 🟡 ¿En qué jurisdicciones son agentes de percepción de IIBB en sus ventas?

## F. Finanzas, cheques y cuentas corrientes

33. 🔴 ¿Qué medios de cobro y de pago usan y en qué proporción? (efectivo, transferencia, cheque físico, ECHEQ, Mercado Pago, tarjeta)
34. 🔴 ¿Cuántas cuentas bancarias y cajas hay? ¿Quién maneja cada una?
35. 🟡 ¿Endosan cheques de clientes a proveedores habitualmente? ¿Descuentan cheques en el banco o en una financiera?
36. 🟡 ¿Qué se hace hoy cuando rebota un cheque? ¿Se le cobran gastos al cliente?
37. 🟡 ¿Sufren retenciones (IIBB, Ganancias, IVA) en los cobros? ¿Son agentes de retención o de percepción?
38. 🟡 ¿Cuál es la condición fiscal de la empresa? ¿En qué jurisdicciones tributan IIBB (Convenio Multilateral)?
39. 🟢 ¿Quieren llevar los sueldos en el sistema o solo como gasto total?
40. 🟢 ¿Qué información necesita el estudio contable y en qué formato?

## G. Reportes y control

41. 🟡 ¿Cuáles son los 5 números que miran (o querrían mirar) todos los días?
42. 🟡 ¿Cómo calculan hoy el costo de una prenda y el margen? ¿Qué método de valuación usa el contador?
43. 🟢 ¿Hacen un cierre mensual? ¿Qué controles hacen hoy?

## H. Migración

44. 🔴 ¿Qué exportaciones permite SISAGO (Excel o CSV) y quién tiene acceso? ¿Podemos ver una muestra?
45. 🟡 ¿Cuánto historial quieren traer: solo saldos abiertos o también ventas históricas para estadísticas?
46. 🟡 ¿Cuándo sería una buena fecha de corte? (Evitar el pico de temporada.)

## T. Decisiones técnicas para el equipo (confirmación de quien encarga el proyecto)

- **T1.** 🔴 ¿Arquitectura NestJS + Next.js (recomendada) o monolito solo en Next.js?
- **T2.** 🔴 ¿Modelo multiempresa desde el día 1 (recomendado, con costo bajo) o empresa única?
- **T3.** 🔴 ¿Orden de puesta en marcha: producción primero (recomendado) o comercial y finanzas primero?
- **T4.** 🟡 ¿Hosting preferido y presupuesto mensual de infraestructura?
- **T5.** 🟡 ¿Identidad visual: hay logo y colores de marca?
- **T6.** 🟢 ¿Tono del microcopy: voseo ("Cargá el pedido") o neutro ("Cargar pedido")? Propuesta: verbos en infinitivo en los botones y voseo en los textos de ayuda.
