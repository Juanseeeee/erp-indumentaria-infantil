import type { Tour } from './types';

/** Primeros pasos: moverse por la plataforma (para todos los usuarios). */
export const TOURS_INICIO: Tour[] = [
  {
    id: 'conocer-la-plataforma',
    area: 'Primeros pasos',
    title: 'Conocer la plataforma',
    description: 'Dónde está el menú, cómo buscar cualquier cosa, el asistente, las alertas y tu cuenta.',
    permissions: [],
    keywords: ['empezar', 'primeros pasos', 'como se usa', 'recorrido', 'tutorial', 'ayuda', 'donde esta', 'menu', 'navegar', 'soy nuevo', 'como funciona'],
    steps: [
      {
        route: '/',
        title: 'Bienvenido',
        body: 'Este recorrido te muestra lo básico para moverte por la plataforma. Usá **Siguiente** para avanzar o **Esc** para salir cuando quieras.',
      },
      {
        route: '/',
        target: 'nav-/',
        title: 'El menú',
        body: 'A la izquierda está el menú, agrupado por áreas (Ventas, Producción, Compras…). Tocá el nombre de un área para desplegarla o plegarla. Solo ves las pantallas que tu usuario tiene permitidas.',
      },
      {
        route: '/',
        target: 'header-search',
        title: 'Buscar o ejecutar una acción',
        body: 'Desde acá (o con **Ctrl + K**) buscás clientes, modelos o documentos por número, y llegás a cualquier pantalla escribiendo su nombre.',
      },
      {
        route: '/',
        target: 'header-assistant',
        title: 'El asistente',
        body: 'Preguntale cómo hacer cualquier tarea (o abrilo con **Ctrl + J**). En el ícono de brújula del asistente están todos los recorridos guiados como este.',
      },
      {
        route: '/',
        target: 'header-alerts',
        title: 'Alertas',
        body: 'La campana avisa lo que necesita tu atención: stock bajo, pedidos demorados, cobros vencidos, según tu rol.',
      },
      {
        route: '/',
        target: 'header-account',
        title: 'Tu cuenta',
        body: 'Tocando tu nombre entrás a tu cuenta: ahí ves tus roles y tus sesiones abiertas, y podés cerrar las de otros dispositivos.',
      },
    ],
  },
];
