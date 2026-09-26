export type Region =
  | 'north-america'
  | 'caribbean'
  | 'latin-america'
  | 'europe'
  | 'asia'
  | 'oceania'
  | 'middle-east'
  | 'africa';

export interface Airport {
  code: string;
  city: string;
  country: string; // ISO 3166-1 alpha-2
  region: Region;
  lat: number;
  lon: number;
  /** Airports people fly *from*. Every airport is a potential destination. */
  hub?: boolean;
  /** Short vibe tag shown on deal cards. */
  vibe?: string;
}

export const REGION_LABELS: Record<Region, string> = {
  'north-america': 'North America',
  caribbean: 'Caribbean',
  'latin-america': 'Latin America',
  europe: 'Europe',
  asia: 'Asia',
  oceania: 'Oceania',
  'middle-east': 'Middle East',
  africa: 'Africa',
};

const A = (
  code: string,
  city: string,
  country: string,
  region: Region,
  lat: number,
  lon: number,
  extra: Partial<Airport> = {},
): Airport => ({ code, city, country, region, lat, lon, ...extra });

const NA: Region = 'north-america';

export const AIRPORTS: Airport[] = [
  // ── US + Canada hubs (origins and destinations) ──────────────────────────
  A('ATL', 'Atlanta', 'US', NA, 33.6407, -84.4277, { hub: true }),
  A('BOS', 'Boston', 'US', NA, 42.3656, -71.0096, { hub: true, vibe: 'Chowder & cobblestones' }),
  A('BWI', 'Baltimore', 'US', NA, 39.1754, -76.6683, { hub: true }),
  A('CLT', 'Charlotte', 'US', NA, 35.214, -80.9431, { hub: true }),
  A('ORD', 'Chicago', 'US', NA, 41.9742, -87.9073, { hub: true, vibe: 'Deep dish & architecture' }),
  A('DFW', 'Dallas', 'US', NA, 32.8998, -97.0403, { hub: true }),
  A('DEN', 'Denver', 'US', NA, 39.8561, -104.6737, { hub: true, vibe: 'Gateway to the Rockies' }),
  A('DTW', 'Detroit', 'US', NA, 42.2162, -83.3554, { hub: true }),
  A('IAH', 'Houston', 'US', NA, 29.9902, -95.3368, { hub: true }),
  A('LAS', 'Las Vegas', 'US', NA, 36.084, -115.1537, { hub: true, vibe: 'Neon & desert' }),
  A('LAX', 'Los Angeles', 'US', NA, 33.9416, -118.4085, { hub: true, vibe: 'Tacos & coastline' }),
  A('MIA', 'Miami', 'US', NA, 25.7959, -80.287, { hub: true, vibe: 'Art deco & ocean drive' }),
  A('MSP', 'Minneapolis', 'US', NA, 44.8848, -93.2223, { hub: true }),
  A('BNA', 'Nashville', 'US', NA, 36.1263, -86.6774, { hub: true, vibe: 'Honky-tonks & hot chicken' }),
  A('MSY', 'New Orleans', 'US', NA, 29.9934, -90.258, { hub: true, vibe: 'Jazz & beignets' }),
  A('JFK', 'New York', 'US', NA, 40.6413, -73.7781, { hub: true, vibe: 'The city that never sleeps' }),
  A('EWR', 'Newark', 'US', NA, 40.6895, -74.1745, { hub: true }),
  A('MCO', 'Orlando', 'US', NA, 28.4312, -81.3081, { hub: true }),
  A('PHL', 'Philadelphia', 'US', NA, 39.8744, -75.2424, { hub: true }),
  A('PHX', 'Phoenix', 'US', NA, 33.4342, -112.0116, { hub: true }),
  A('PDX', 'Portland', 'US', NA, 45.5898, -122.5951, { hub: true, vibe: 'Forests & food carts' }),
  A('RDU', 'Raleigh', 'US', NA, 35.8801, -78.7880, { hub: true }),
  A('SLC', 'Salt Lake City', 'US', NA, 40.7899, -111.9791, { hub: true, vibe: 'Powder days' }),
  A('SAN', 'San Diego', 'US', NA, 32.7338, -117.1933, { hub: true, vibe: 'Surf & sunshine' }),
  A('SFO', 'San Francisco', 'US', NA, 37.6213, -122.379, { hub: true, vibe: 'Fog, hills & sourdough' }),
  A('SEA', 'Seattle', 'US', NA, 47.4502, -122.3088, { hub: true, vibe: 'Coffee & evergreens' }),
  A('TPA', 'Tampa', 'US', NA, 27.9755, -82.5332, { hub: true }),
  A('IAD', 'Washington', 'US', NA, 38.9531, -77.4565, { hub: true, vibe: 'Monuments & museums' }),
  A('AUS', 'Austin', 'US', NA, 30.1975, -97.6664, { hub: true, vibe: 'Live music & BBQ' }),
  A('YYZ', 'Toronto', 'CA', NA, 43.6777, -79.6248, { hub: true }),
  A('YVR', 'Vancouver', 'CA', NA, 49.1967, -123.1815, { hub: true, vibe: 'Mountains meet ocean' }),

  // ── More North America destinations ──────────────────────────────────────
  A('HNL', 'Honolulu', 'US', NA, 21.3187, -157.9225, { vibe: 'Waikiki & poke' }),
  A('OGG', 'Maui', 'US', NA, 20.8986, -156.4305, { vibe: 'Road to Hana' }),
  A('ANC', 'Anchorage', 'US', NA, 61.1743, -149.9982, { vibe: 'Glaciers & northern lights' }),
  A('BZN', 'Bozeman', 'US', NA, 45.7769, -111.1603, { vibe: 'Yellowstone base camp' }),
  A('JAC', 'Jackson Hole', 'US', NA, 43.6073, -110.7377, { vibe: 'Tetons & ski slopes' }),
  A('SAV', 'Savannah', 'US', NA, 32.1276, -81.2021, { vibe: 'Spanish moss & squares' }),
  A('CHS', 'Charleston', 'US', NA, 32.8986, -80.0405, { vibe: 'Lowcountry charm' }),
  A('SJU', 'San Juan', 'PR', 'caribbean', 18.4394, -66.0018, { vibe: 'Old San Juan & beaches' }),
  A('YUL', 'Montréal', 'CA', NA, 45.4706, -73.7408, { vibe: 'Bagels & cobblestones' }),

  // ── Caribbean + Mexico + Central/South America ───────────────────────────
  A('CUN', 'Cancún', 'MX', 'latin-america', 21.0365, -86.8771, { vibe: 'Turquoise water & cenotes' }),
  A('MEX', 'Mexico City', 'MX', 'latin-america', 19.4361, -99.0719, { vibe: 'Tacos al pastor & murals' }),
  A('SJD', 'Los Cabos', 'MX', 'latin-america', 23.1518, -109.7215, { vibe: 'Desert meets sea' }),
  A('PVR', 'Puerto Vallarta', 'MX', 'latin-america', 20.6801, -105.2544, { vibe: 'Beach town sunsets' }),
  A('OAX', 'Oaxaca', 'MX', 'latin-america', 16.9999, -96.7266, { vibe: 'Mezcal & mole' }),
  A('GDL', 'Guadalajara', 'MX', 'latin-america', 20.5218, -103.3112, { vibe: 'Mariachi & tequila' }),
  A('NAS', 'Nassau', 'BS', 'caribbean', 25.039, -77.4662, { vibe: 'Swimming pigs' }),
  A('MBJ', 'Montego Bay', 'JM', 'caribbean', 18.5037, -77.9134, { vibe: 'Reggae & jerk' }),
  A('PUJ', 'Punta Cana', 'DO', 'caribbean', 18.5674, -68.3634, { vibe: 'All-inclusive bliss' }),
  A('AUA', 'Aruba', 'AW', 'caribbean', 12.5014, -70.0152, { vibe: 'Always sunny' }),
  A('STT', 'St. Thomas', 'VI', 'caribbean', 18.3373, -64.9734, { vibe: 'No passport paradise' }),
  A('SJO', 'San José', 'CR', 'latin-america', 9.9939, -84.2088, { vibe: 'Pura vida' }),
  A('LIR', 'Liberia', 'CR', 'latin-america', 10.5933, -85.5444, { vibe: 'Guanacaste surf' }),
  A('PTY', 'Panama City', 'PA', 'latin-america', 9.0714, -79.3835, { vibe: 'Canal & skyline' }),
  A('BZE', 'Belize City', 'BZ', 'latin-america', 17.5391, -88.3082, { vibe: 'Barrier reef diving' }),
  A('BOG', 'Bogotá', 'CO', 'latin-america', 4.7016, -74.1469, { vibe: 'Andes & arepas' }),
  A('MDE', 'Medellín', 'CO', 'latin-america', 6.1645, -75.4231, { vibe: 'City of eternal spring' }),
  A('CTG', 'Cartagena', 'CO', 'latin-america', 10.4424, -75.513, { vibe: 'Colorful walled city' }),
  A('LIM', 'Lima', 'PE', 'latin-america', -12.0219, -77.1143, { vibe: 'Ceviche capital' }),
  A('CUZ', 'Cusco', 'PE', 'latin-america', -13.5357, -71.9388, { vibe: 'Gateway to Machu Picchu' }),
  A('UIO', 'Quito', 'EC', 'latin-america', -0.1292, -78.3575, { vibe: 'Equator & volcanoes' }),
  A('GRU', 'São Paulo', 'BR', 'latin-america', -23.4356, -46.4731, { vibe: 'Megacity food scene' }),
  A('GIG', 'Rio de Janeiro', 'BR', 'latin-america', -22.809, -43.2506, { vibe: 'Beaches & samba' }),
  A('EZE', 'Buenos Aires', 'AR', 'latin-america', -34.8222, -58.5358, { vibe: 'Tango & steak' }),
  A('SCL', 'Santiago', 'CL', 'latin-america', -33.393, -70.7858, { vibe: 'Andes & wine valleys' }),

  // ── Europe ────────────────────────────────────────────────────────────────
  A('LHR', 'London', 'GB', 'europe', 51.47, -0.4543, { vibe: 'Pubs & palaces' }),
  A('DUB', 'Dublin', 'IE', 'europe', 53.4264, -6.2499, { vibe: 'Pints & green hills' }),
  A('EDI', 'Edinburgh', 'GB', 'europe', 55.95, -3.3725, { vibe: 'Castles & closes' }),
  A('KEF', 'Reykjavík', 'IS', 'europe', 63.985, -22.6056, { vibe: 'Hot springs & auroras' }),
  A('CDG', 'Paris', 'FR', 'europe', 49.0097, 2.5479, { vibe: 'Croissants & the Seine' }),
  A('NCE', 'Nice', 'FR', 'europe', 43.6584, 7.2159, { vibe: 'Riviera sunshine' }),
  A('AMS', 'Amsterdam', 'NL', 'europe', 52.3105, 4.7683, { vibe: 'Canals & bikes' }),
  A('BRU', 'Brussels', 'BE', 'europe', 50.901, 4.4844, { vibe: 'Waffles & frites' }),
  A('FRA', 'Frankfurt', 'DE', 'europe', 50.0379, 8.5622),
  A('MUC', 'Munich', 'DE', 'europe', 48.3538, 11.7861, { vibe: 'Beer halls & Alps' }),
  A('BER', 'Berlin', 'DE', 'europe', 52.3667, 13.5033, { vibe: 'Techno & history' }),
  A('CPH', 'Copenhagen', 'DK', 'europe', 55.618, 12.656, { vibe: 'Hygge & harbors' }),
  A('ARN', 'Stockholm', 'SE', 'europe', 59.6519, 17.9186, { vibe: 'Archipelago & fika' }),
  A('OSL', 'Oslo', 'NO', 'europe', 60.1976, 11.1004, { vibe: 'Fjords await' }),
  A('HEL', 'Helsinki', 'FI', 'europe', 60.3172, 24.9633, { vibe: 'Saunas & design' }),
  A('ZRH', 'Zurich', 'CH', 'europe', 47.4582, 8.5555, { vibe: 'Lakes & mountains' }),
  A('VIE', 'Vienna', 'AT', 'europe', 48.1103, 16.5697, { vibe: 'Coffee houses & opera' }),
  A('PRG', 'Prague', 'CZ', 'europe', 50.1008, 14.26, { vibe: 'Fairytale old town' }),
  A('BUD', 'Budapest', 'HU', 'europe', 47.4394, 19.2556, { vibe: 'Thermal baths & ruin bars' }),
  A('KRK', 'Kraków', 'PL', 'europe', 50.0777, 19.7848, { vibe: 'Medieval square & pierogi' }),
  A('MAD', 'Madrid', 'ES', 'europe', 40.4983, -3.5676, { vibe: 'Late nights & tapas' }),
  A('BCN', 'Barcelona', 'ES', 'europe', 41.2974, 2.0833, { vibe: 'Gaudí & beaches' }),
  A('LIS', 'Lisbon', 'PT', 'europe', 38.7742, -9.1342, { vibe: 'Pastéis & hills' }),
  A('OPO', 'Porto', 'PT', 'europe', 41.2481, -8.6814, { vibe: 'Port wine & tiles' }),
  A('PDL', 'Azores', 'PT', 'europe', 37.7412, -25.6979, { vibe: 'Volcanic lakes' }),
  A('FCO', 'Rome', 'IT', 'europe', 41.8003, 12.2389, { vibe: 'Pasta & ruins' }),
  A('MXP', 'Milan', 'IT', 'europe', 45.6301, 8.7255, { vibe: 'Fashion & aperitivo' }),
  A('VCE', 'Venice', 'IT', 'europe', 45.5053, 12.3519, { vibe: 'Gondolas & cicchetti' }),
  A('NAP', 'Naples', 'IT', 'europe', 40.886, 14.2908, { vibe: 'Pizza & Amalfi Coast' }),
  A('ATH', 'Athens', 'GR', 'europe', 37.9364, 23.9445, { vibe: 'Acropolis & islands' }),
  A('DBV', 'Dubrovnik', 'HR', 'europe', 42.5614, 18.2682, { vibe: 'Adriatic walls' }),
  A('IST', 'Istanbul', 'TR', 'europe', 41.2753, 28.7519, { vibe: 'Where continents meet' }),

  // ── Middle East + Africa ─────────────────────────────────────────────────
  A('DXB', 'Dubai', 'AE', 'middle-east', 25.2532, 55.3657, { vibe: 'Skyscrapers & souks' }),
  A('DOH', 'Doha', 'QA', 'middle-east', 25.2731, 51.6081),
  A('TLV', 'Tel Aviv', 'IL', 'middle-east', 32.0055, 34.8854, { vibe: 'Beaches & hummus' }),
  A('AMM', 'Amman', 'JO', 'middle-east', 31.7226, 35.9932, { vibe: 'Gateway to Petra' }),
  A('RAK', 'Marrakech', 'MA', 'africa', 31.6069, -8.0363, { vibe: 'Medinas & mint tea' }),
  A('CMN', 'Casablanca', 'MA', 'africa', 33.3675, -7.5899),
  A('CAI', 'Cairo', 'EG', 'africa', 30.1219, 31.4056, { vibe: 'Pyramids & the Nile' }),
  A('CPT', 'Cape Town', 'ZA', 'africa', -33.9715, 18.6021, { vibe: 'Table Mountain & wine' }),
  A('NBO', 'Nairobi', 'KE', 'africa', -1.3192, 36.9278, { vibe: 'Safari country' }),
  A('ACC', 'Accra', 'GH', 'africa', 5.6052, -0.1668, { vibe: 'Jollof & beaches' }),

  // ── Asia ────────────────────────────────────────────────────────────────
  A('NRT', 'Tokyo', 'JP', 'asia', 35.772, 140.3929, { vibe: 'Ramen & neon' }),
  A('HND', 'Tokyo Haneda', 'JP', 'asia', 35.5494, 139.7798, { vibe: 'Ramen & neon' }),
  A('KIX', 'Osaka', 'JP', 'asia', 34.4347, 135.244, { vibe: 'Street food & Kyoto day trips' }),
  A('ICN', 'Seoul', 'KR', 'asia', 37.4602, 126.4407, { vibe: 'K-BBQ & palaces' }),
  A('TPE', 'Taipei', 'TW', 'asia', 25.0797, 121.2342, { vibe: 'Night markets' }),
  A('HKG', 'Hong Kong', 'HK', 'asia', 22.308, 113.9185, { vibe: 'Dim sum & harbor views' }),
  A('MNL', 'Manila', 'PH', 'asia', 14.5086, 121.0198, { vibe: 'Island hopping base' }),
  A('BKK', 'Bangkok', 'TH', 'asia', 13.69, 100.7501, { vibe: 'Temples & street food' }),
  A('HKT', 'Phuket', 'TH', 'asia', 8.1132, 98.3169, { vibe: 'Andaman beaches' }),
  A('SGN', 'Ho Chi Minh City', 'VN', 'asia', 10.8188, 106.6519, { vibe: 'Phở & motorbikes' }),
  A('HAN', 'Hanoi', 'VN', 'asia', 21.2212, 105.8072, { vibe: 'Old Quarter & Ha Long Bay' }),
  A('SIN', 'Singapore', 'SG', 'asia', 1.3644, 103.9915, { vibe: 'Hawker centers' }),
  A('KUL', 'Kuala Lumpur', 'MY', 'asia', 2.7456, 101.7099, { vibe: 'Towers & laksa' }),
  A('DPS', 'Bali', 'ID', 'asia', -8.7482, 115.1675, { vibe: 'Rice terraces & surf' }),
  A('DEL', 'Delhi', 'IN', 'asia', 28.5562, 77.1, { vibe: 'Spice & history' }),
  A('BOM', 'Mumbai', 'IN', 'asia', 19.0896, 72.8656, { vibe: 'Bollywood & street eats' }),

  // ── Oceania ──────────────────────────────────────────────────────────────
  A('SYD', 'Sydney', 'AU', 'oceania', -33.9399, 151.1753, { vibe: 'Harbour & beaches' }),
  A('MEL', 'Melbourne', 'AU', 'oceania', -37.669, 144.841, { vibe: 'Laneways & flat whites' }),
  A('AKL', 'Auckland', 'NZ', 'oceania', -37.0082, 174.785, { vibe: 'Middle-earth awaits' }),
  A('NAN', 'Fiji', 'FJ', 'oceania', -17.7554, 177.4431, { vibe: 'Overwater bungalows' }),
  A('PPT', 'Tahiti', 'PF', 'oceania', -17.5537, -149.6072, { vibe: 'Lagoon paradise' }),
];

export const AIRPORT_BY_CODE = new Map(AIRPORTS.map((a) => [a.code, a]));

export function getAirport(code: string): Airport | undefined {
  return AIRPORT_BY_CODE.get(code.toUpperCase());
}

/** Great-circle distance in statute miles. */
export function distanceMiles(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 3958.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Airports whose city is effectively the same place (skip scanning between them). */
const SAME_METRO: string[][] = [
  ['JFK', 'EWR'],
  ['NRT', 'HND'],
  ['IAD', 'BWI'],
  ['OGG', 'HNL'],
];

export function sameMetro(a: string, b: string): boolean {
  return SAME_METRO.some((g) => g.includes(a) && g.includes(b));
}
