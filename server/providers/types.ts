export interface FareQuery {
  origin: string;
  destination: string;
  departDate: string; // YYYY-MM-DD
  returnDate?: string; // YYYY-MM-DD, omit for one-way
}

export interface Itinerary {
  price: number;
  airlines: string[];
  airlineCode: string; // IATA code, or "multi"
  stops: number;
  durationMinutes: number;
  departTime: string; // HH:MM local
  arriveTime: string; // HH:MM local
  arriveDate: string;
  via: string[]; // connecting airports
}

export interface PriceInsight {
  /** Google's price level: 1–2 low, 3 typical, 4–5 high (approx). */
  level: number | null;
  current: number | null;
  typical: number | null;
  typicalLow: number | null;
  typicalHigh: number | null;
  /** Daily lowest price seen for this search over ~60 days: [epochMs, price]. */
  history: [number, number][];
}

export interface PlaceInfo {
  code: string;
  city: string | null;
  country: string | null;
  image: string | null;
}

export interface FareResult {
  query: FareQuery;
  currency: string;
  cheapest: Itinerary | null;
  itineraries: Itinerary[];
  insight: PriceInsight | null;
  origin: PlaceInfo | null;
  destination: PlaceInfo | null;
  bookingUrl: string;
  fetchedAt: number;
}

export interface FareProvider {
  name: string;
  search(q: FareQuery, signal?: AbortSignal): Promise<FareResult>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
    public readonly status?: number,
  ) {
    super(message);
  }
}
