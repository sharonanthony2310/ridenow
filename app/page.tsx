
"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Show, UserButton, useAuth } from "@clerk/nextjs";
import AddressSearch, { type Place } from "./components/AddressSearch";
import RouteInfo from "./components/RouteInfo";
import FareCalculator from "./components/FareCalculator";
import type { MapLocation } from "./components/RouteMap";

const RouteMap = dynamic(() => import("./components/RouteMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full min-h-[480px] items-center justify-center bg-gray-100">
      Loading map...
    </div>
  ),
});

type CabType = "Mini" | "Sedan" | "XL";

type SavedRide = {
  id: string;
  pickup_name: string;
  dropoff_name: string;
  cab_type: CabType;
  distance_km: number;
  estimated_fare: number;
  status: string;
  created_at: string;
};

const API_URL = "http://localhost:4000";

async function readApiResponse(response: Response): Promise<any> {
  const text = await response.text();

  if (!text.trim()) {
    if (!response.ok) {
      throw new Error(`Server error (${response.status}). Please try again.`);
    }

    throw new Error("The server returned an empty response.");
  }

  let result: any;

  try {
    result = JSON.parse(text);
  } catch {
    if (response.status === 404) {
      throw new Error(
        "The booking API was not found. Check that your Express server is running on port 4000."
      );
    }

    if (response.status >= 500) {
      throw new Error(
        "The booking server encountered an error. Check the VS Code backend terminal."
      );
    }

    throw new Error(
      `The server returned an unexpected response instead of JSON (HTTP ${response.status}). Check that the Express backend is running at ${API_URL}.`
    );
  }

  if (!response.ok) {
    throw new Error(
      typeof result.error === "string"
        ? result.error
        : `Request failed with HTTP ${response.status}.`
    );
  }

  return result;
}

export default function Home() {
  const router = useRouter();
  const { isLoaded, isSignedIn, getToken } = useAuth();

  const [pickup, setPickup] = useState<Place | null>(null);
  const [dropoff, setDropoff] = useState<Place | null>(null);
  const [distanceKm, setDistanceKm] = useState<number | null>(null);
  const [routeCoordinates, setRouteCoordinates] = useState<
    [number, number][] | null
  >(null);
  const [selectionMode, setSelectionMode] = useState<"pickup" | "dropoff">(
    "pickup"
  );
  const [cabType, setCabType] = useState<CabType>("Sedan");
  const [passengers, setPassengers] = useState("1");
  const [rides, setRides] = useState<SavedRide[]>([]);
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const rates: Record<CabType, { base: number; rate: number }> = {
    Mini: { base: 40, rate: 12 },
    Sedan: { base: 60, rate: 18 },
    XL: { base: 80, rate: 24 },
  };

  const fare =
    distanceKm !== null && distanceKm > 0
      ? Math.round(rates[cabType].base + distanceKm * rates[cabType].rate)
      : null;

  function changePickup(place: Place) {
    setPickup(place);
    setDistanceKm(null);
    setRouteCoordinates(null);
    setMessage("");
  }

  function changeDropoff(place: Place) {
    setDropoff(place);
    setDistanceKm(null);
    setRouteCoordinates(null);
    setMessage("");
  }

  function handleMapSelect(location: MapLocation) {
    const place: Place = {
      name: `${location.lat.toFixed(5)}, ${location.lng.toFixed(5)}`,
      lat: location.lat,
      lng: location.lng,
    };

    if (selectionMode === "pickup") {
      changePickup(place);
    } else {
      changeDropoff(place);
    }
  }

  async function requestRide() {
    if (!pickup || !dropoff || distanceKm === null || fare === null) {
      setMessage(
        "Choose your pickup and destination, then calculate the route."
      );
      return;
    }

    if (!isLoaded) {
      setMessage("Please wait while authentication loads.");
      return;
    }

    if (!isSignedIn) {
      router.push("/sign-in?redirect_url=/");
      return;
    }

    setIsSubmitting(true);
    setMessage("");

    try {
      const token = await getToken();

      if (!token) {
        throw new Error(
          "Your session could not be verified. Please sign in again."
        );
      }

      const response = await fetch(`${API_URL}/api/rides`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          pickup,
          dropoff,
          cabType,
          distanceKm,
          passengerCount: Number(passengers),
        }),
      });

      const result = await readApiResponse(response);

      if (!result.ride || !result.ride.id) {
        throw new Error(
          "The server did not return a valid booking confirmation. Check your backend."
        );
      }

      const ride = result.ride as SavedRide;

      setRides((current) => [ride, ...current]);
      setMessage(`Ride booked successfully. Reference: ${ride.id}`);
    } catch (error) {
      if (
        error instanceof TypeError &&
        /fetch/i.test(error.message)
      ) {
        setMessage(
          "Cannot connect to the booking server. Make sure the Express backend is running on port 4000."
        );
      } else {
        setMessage(
          error instanceof Error
            ? error.message
            : "An unexpected error occurred while booking your ride."
        );
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-100 text-slate-900">
      <header className="sticky top-0 z-[1000] border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-[1800px] items-center justify-between gap-4 px-5 py-3 lg:px-8">
          <Link
            href="/"
            className="shrink-0 text-2xl font-extrabold tracking-tight"
          >
            Ride<span className="text-green-600">Now</span>
          </Link>

          <nav className="hidden items-center gap-6 text-sm font-medium text-slate-600 md:flex">
            <a href="#book" className="hover:text-green-700">
              Book a ride
            </a>
            <a href="#map" className="hover:text-green-700">
              Explore map
            </a>
            <Link href="/my-rides" className="hover:text-green-700">
              My Rides
            </Link>
          </nav>

          <div className="flex shrink-0 items-center gap-3">
            <Show when="signed-out">
              <Link
                href="/sign-in?redirect_url=/"
                className="rounded-lg px-3 py-2 text-sm font-semibold hover:bg-slate-100"
              >
                Sign in
              </Link>
              <Link
                href="/sign-up?redirect_url=/"
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
              >
                Sign up
              </Link>
            </Show>

            <Show when="signed-in">
              <Link
                href="/my-rides"
                className="rounded-lg px-3 py-2 text-sm font-semibold hover:bg-slate-100"
              >
                My Rides
              </Link>
              <UserButton />
            </Show>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1800px] px-4 py-5 lg:px-8 lg:py-7">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-green-700">
              Your city. Your journey.
            </p>
            <h1 className="mt-1 text-2xl font-extrabold tracking-tight sm:text-3xl">
              Where would you like to go?
            </h1>
          </div>
          <p className="text-sm text-slate-500">
            Explore routes and fares for free. Sign in to book.
          </p>
        </div>

        <div className="grid items-start gap-5 xl:grid-cols-[400px_minmax(0,1fr)] 2xl:grid-cols-[430px_minmax(0,1fr)]">
          <section
            id="book"
            className="order-2 min-w-0 space-y-4 xl:order-1"
          >
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-5">
                <h2 className="text-lg font-bold">Plan your ride</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Your route and estimated fare are available without an
                  account.
                </p>
              </div>

              <div className="space-y-4">
                <AddressSearch
                  label="Pickup location"
                  onSelect={changePickup}
                />

                <AddressSearch
                  label="Destination"
                  onSelect={changeDropoff}
                />

                <div>
                  <label
                    htmlFor="passengers"
                    className="mb-2 block text-sm font-semibold"
                  >
                    Number of passengers
                  </label>
                  <select
                    id="passengers"
                    value={passengers}
                    onChange={(event) => setPassengers(event.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-3 text-sm outline-none focus:border-green-600 focus:ring-2 focus:ring-green-100"
                  >
                    {[1, 2, 3, 4, 5, 6].map((count) => (
                      <option key={count} value={count}>
                        {count} passenger{count > 1 ? "s" : ""}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="rounded-xl bg-slate-50 p-3">
                  <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">
                    Choose points on the map
                  </p>

                  <MapClickControls
                    selectionMode={selectionMode}
                    onSelectionModeChange={setSelectionMode}
                  />

                  <p className="mt-2 text-xs text-slate-500">
                    Select pickup or destination, then click the map.
                  </p>
                </div>

                <div className="space-y-3">
                  <div className="rounded-lg border border-green-100 bg-green-50 p-3">
                    <p className="text-xs font-bold uppercase tracking-wide text-green-800">
                      Pickup
                    </p>
                    <p className="mt-1 break-words text-sm text-green-950">
                      {pickup?.name ?? "Choose a pickup location"}
                    </p>
                  </div>

                  <div className="rounded-lg border border-red-100 bg-red-50 p-3">
                    <p className="text-xs font-bold uppercase tracking-wide text-red-800">
                      Destination
                    </p>
                    <p className="mt-1 break-words text-sm text-red-950">
                      {dropoff?.name ?? "Choose your destination"}
                    </p>
                  </div>
                </div>

                <RouteInfo
                  pickup={pickup}
                  dropoff={dropoff}
                  onRouteCalculated={(km, coordinates) => {
                    setDistanceKm(km);
                    setRouteCoordinates(coordinates);
                    setMessage("");
                  }}
                />

                <div className="border-t border-slate-100 pt-4">
                  <FareCalculator
                    distanceKm={distanceKm}
                    cabType={cabType}
                    onCabTypeChange={setCabType}
                  />
                </div>

                {fare !== null && (
                  <div className="rounded-xl border border-green-200 bg-green-50 p-4">
                    <div className="flex items-end justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-green-800">
                          Estimated fare
                        </p>
                        <p className="mt-1 text-3xl font-extrabold text-green-950">
                          ₹{fare}
                        </p>
                      </div>

                      <div className="text-right text-sm text-green-800">
                        <p>{cabType}</p>
                        <p>{distanceKm?.toFixed(1) ?? "—"} km</p>
                      </div>
                    </div>

                    <p className="mt-2 text-xs text-green-800">
                      This is an estimate; the final fare may differ.
                    </p>
                  </div>
                )}

                <button
                  type="button"
                  onClick={requestRide}
                  disabled={isSubmitting || !isLoaded}
                  className="w-full rounded-xl bg-green-600 px-5 py-4 font-bold text-white shadow-sm transition hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isSubmitting
                    ? "Booking ride..."
                    : !isLoaded
                      ? "Loading..."
                      : !isSignedIn
                        ? "Sign in to book this ride"
                        : "Book this ride"}
                </button>

                <Show when="signed-out">
                  <p className="text-center text-xs leading-5 text-slate-500">
                    You can calculate fares as a guest. Sign in or create an
                    account to confirm your booking.
                  </p>
                </Show>

                {message && (
                  <div
                    role="status"
                    className="break-words rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm"
                  >
                    {message}
                  </div>
                )}
              </div>
            </div>

            <div
              id="requests"
              className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
            >
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-bold">Recent bookings</h2>
                <Show when="signed-in">
                  <Link
                    href="/my-rides"
                    className="text-sm font-semibold text-green-700 hover:text-green-800"
                  >
                    View all
                  </Link>
                </Show>
              </div>

              <p className="mt-1 text-sm text-slate-500">
                Bookings made during this session appear here.
              </p>

              {rides.length === 0 ? (
                <p className="mt-3 text-sm text-slate-500">
                  No bookings created in this session yet.
                </p>
              ) : (
                <div className="mt-4 space-y-3">
                  {rides.map((ride) => (
                    <article
                      key={ride.id}
                      className="rounded-xl border border-slate-200 p-3"
                    >
                      <p className="break-all text-xs text-slate-500">
                        Reference: {ride.id}
                      </p>
                      <p className="mt-1 font-semibold">
                        {ride.cab_type} · {ride.distance_km} km
                      </p>
                      <p className="mt-2 break-words text-sm text-slate-600">
                        {ride.pickup_name} → {ride.dropoff_name}
                      </p>
                      <p className="mt-2 font-bold">
                        ₹{ride.estimated_fare}
                      </p>
                      <p className="mt-1 text-xs capitalize text-slate-500">
                        Status: {ride.status}
                      </p>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </section>

          <section id="map" className="order-1 min-w-0 xl:order-2">
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 lg:px-5">
                <div>
                  <h2 className="font-bold">Explore the map</h2>
                  <p className="mt-1 text-xs text-slate-500">
                    Select locations and view your driving route.
                  </p>
                </div>

                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                  OpenStreetMap
                </span>
              </div>

              <div className="h-[480px] sm:h-[560px] xl:h-[calc(100vh-190px)] xl:min-h-[600px] xl:max-h-[1000px]">
                <RouteMap
                  pickup={pickup}
                  dropoff={dropoff}
                  route={routeCoordinates}
                  selectionMode={selectionMode}
                  onMapSelect={handleMapSelect}
                />
              </div>

              <div className="grid gap-3 border-t border-slate-200 p-4 sm:grid-cols-3">
                <div className="flex items-center gap-2 text-sm">
                  <span className="h-3 w-3 rounded-full bg-green-600" />
                  <span className="text-slate-600">
                    {pickup ? "Pickup selected" : "Pickup not selected"}
                  </span>
                </div>

                <div className="flex items-center gap-2 text-sm">
                  <span className="h-3 w-3 rounded-full bg-red-500" />
                  <span className="text-slate-600">
                    {dropoff
                      ? "Destination selected"
                      : "Destination not selected"}
                  </span>
                </div>

                <div className="text-sm font-semibold text-slate-700">
                  {distanceKm !== null
                    ? `${distanceKm.toFixed(1)} km route`
                    : "Route not calculated"}
                </div>
              </div>
            </div>

            <p className="mt-3 text-xs leading-5 text-slate-500">
              Map and route availability depends on the public mapping
              services.
            </p>
          </section>
        </div>
      </div>

      <footer className="border-t border-slate-200 bg-white px-5 py-5 text-center text-xs text-slate-500">
        RideNow · Map data © OpenStreetMap contributors
      </footer>
    </main>
  );
}

function MapClickControls({
  selectionMode,
  onSelectionModeChange,
}: {
  selectionMode: "pickup" | "dropoff";
  onSelectionModeChange: (mode: "pickup" | "dropoff") => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <button
        type="button"
        onClick={() => onSelectionModeChange("pickup")}
        aria-pressed={selectionMode === "pickup"}
        className={`rounded-lg px-3 py-2.5 text-sm font-semibold transition ${
          selectionMode === "pickup"
            ? "bg-green-600 text-white"
            : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
        }`}
      >
        Set pickup
      </button>

      <button
        type="button"
        onClick={() => onSelectionModeChange("dropoff")}
        aria-pressed={selectionMode === "dropoff"}
        className={`rounded-lg px-3 py-2.5 text-sm font-semibold transition ${
          selectionMode === "dropoff"
            ? "bg-red-600 text-white"
            : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
        }`}
      >
        Set destination
      </button>
    </div>
  );
}
