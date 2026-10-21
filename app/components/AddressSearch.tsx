
"use client";

import { useState } from "react";

export type Place = {
  name: string;
  lat: number;
  lng: number;
};

type AddressSearchProps = {
  label: string;
  onSelect: (place: Place) => void;
};

export default function AddressSearch({
  label,
  onSelect,
}: AddressSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Place[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function searchAddress() {
    if (!query.trim()) {
      setError("Enter an address or place name.");
      return;
    }

    setLoading(true);
    setError("");
    setResults([]);

    try {
      const params = new URLSearchParams({
        q: query.trim(),
        format: "jsonv2",
        limit: "5",
      });

      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?${params}`
      );

      if (!response.ok) {
        throw new Error("Address search is temporarily unavailable.");
      }

      const data = await response.json();

      const places: Place[] = data.map(
        (item: {
          display_name: string;
          lat: string;
          lon: string;
        }) => ({
          name: item.display_name,
          lat: Number(item.lat),
          lng: Number(item.lon),
        })
      );

      setResults(places);

      if (places.length === 0) {
        setError("No matching places found. Try a more specific address.");
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Address search failed."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="space-y-3">
      <label className="block text-sm font-semibold text-gray-800">
        {label}
      </label>

      <div className="flex gap-2">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void searchAddress();
            }
          }}
          placeholder={`Search ${label.toLowerCase()}`}
          className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-3 text-sm outline-none focus:border-black"
        />

        <button
          type="button"
          onClick={() => void searchAddress()}
          disabled={loading}
          className="rounded-lg bg-black px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
        >
          {loading ? "Searching..." : "Search"}
        </button>
      </div>

      {error && (
        <p role="status" className="text-sm text-gray-600">
          {error}
        </p>
      )}

      {results.length > 0 && (
        <ul className="divide-y rounded-lg border border-gray-200">
          {results.map((place, index) => (
            <li key={`${place.lat}-${place.lng}-${index}`}>
              <button
                type="button"
                onClick={() => {
                  onSelect(place);
                  setQuery(place.name);
                  setResults([]);
                  setError("");
                }}
                className="w-full p-3 text-left text-sm text-gray-700 hover:bg-gray-50"
              >
                {place.name}
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-gray-500">
        Search is powered by OpenStreetMap's Nominatim service. Its public
        server has strict usage limits; we will review production options
        before launching.
      </p>
    </section>
  );
}
