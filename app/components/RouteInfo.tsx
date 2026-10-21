
"use client";

import { useState } from "react";

type Location = {
  lat: number;
  lng: number;
};

type RouteInfoProps = {
  pickup: Location | null;
  dropoff: Location | null;
  onRouteCalculated: (
    distanceKm: number,
    coordinates: [number, number][]
  ) => void;
};

export default function RouteInfo({
  pickup,
  dropoff,
  onRouteCalculated,
}: RouteInfoProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [distanceKm, setDistanceKm] = useState<number | null>(null);
  const [durationMinutes, setDurationMinutes] = useState<number | null>(null);

  async function calculateRoute() {
    if (!pickup || !dropoff) {
      setError("Select both pickup and destination first.");
      return;
    }

    setLoading(true);
    setError("");
    setDistanceKm(null);
    setDurationMinutes(null);

    try {
      const url =
        `https://router.project-osrm.org/route/v1/driving/` +
        `${pickup.lng},${pickup.lat};${dropoff.lng},${dropoff.lat}` +
        "?overview=full&geometries=geojson";

      const response = await fetch(url);

      if (!response.ok) {
        throw new Error("The routing service is unavailable.");
      }

      const data = await response.json();

      if (data.code !== "Ok" || !data.routes?.length) {
        throw new Error("No driving route found for these locations.");
      }

      const route = data.routes[0];
      const km = Number((route.distance / 1000).toFixed(2));
      const minutes = Math.ceil(route.duration / 60);

      const coordinates: [number, number][] =
        route.geometry.coordinates.map(
          ([lng, lat]: [number, number]) => [lat, lng]
        );

      setDistanceKm(km);
      setDurationMinutes(minutes);
      onRouteCalculated(km, coordinates);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not calculate the route."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="space-y-3 rounded-xl border border-gray-200 p-4">
      <h2 className="text-lg font-semibold text-gray-900">Route details</h2>

      <button
        type="button"
        onClick={calculateRoute}
        disabled={loading || !pickup || !dropoff}
        className="rounded-lg bg-black px-4 py-3 font-semibold text-white disabled:opacity-50"
      >
        {loading ? "Calculating..." : "Calculate route"}
      </button>

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

      {distanceKm !== null && durationMinutes !== null && (
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg bg-gray-50 p-3">
            <p className="text-sm text-gray-500">Road distance</p>
            <p className="text-xl font-bold">{distanceKm} km</p>
          </div>
          <div className="rounded-lg bg-gray-50 p-3">
            <p className="text-sm text-gray-500">Estimated drive</p>
            <p className="text-xl font-bold">{durationMinutes} min</p>
          </div>
        </div>
      )}

      <p className="text-xs text-gray-500">
        Estimates only. Routing uses the public OSRM demo service.
      </p>
    </section>
  );
}
