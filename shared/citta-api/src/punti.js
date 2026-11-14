// Altri luoghi noti di Napoli, fuori dai 10 luoghi monitorati della mappa (luoghi.js), che le
// persone nominano spesso e che non sono stazioni: per esempio la sede dell'hackathon. Servono
// solo a trovare il punto (stazioni vicine, luogo monitorato più vicino per meteo e aria, dichiarato).
// Non hanno sensori, folla né eventi propri. Coordinate indicative (precisione di circa 100 m).
// Stessa forma di LUOGHI ({ nome, lat, lon, parole }), così vale la stessa ricerca tollerante.

export const PUNTI = Object.freeze({
  citta_scienza: {
    nome: 'Città della Scienza',
    categoria: 'Museo e centro congressi (Bagnoli-Coroglio)',
    lat: 40.8061,
    lon: 14.1781,
    parole: ['Città della Scienza', 'Coroglio', 'Via Coroglio', 'Corporea', 'Planetario', 'Futuro Remoto', 'Big Hack', 'hackathon'],
  },
  aeroporto: {
    nome: 'Aeroporto di Napoli Capodichino',
    categoria: 'Aeroporto',
    lat: 40.8862,
    lon: 14.2908,
    parole: ['Aeroporto', 'Capodichino', 'Aeroporto di Napoli', 'Aeroporto Capodichino'],
  },
  virgiliano: {
    nome: 'Parco Virgiliano',
    categoria: 'Parco (Posillipo)',
    lat: 40.7987,
    lon: 14.1829,
    parole: ['Parco Virgiliano', 'Virgiliano', 'Parco della Rimembranza'],
  },
  marechiaro: {
    nome: 'Marechiaro',
    categoria: 'Borgo sul mare (Posillipo)',
    lat: 40.7946,
    lon: 14.1968,
    parole: ['Marechiaro', 'Borgo Marechiaro'],
  },
});
