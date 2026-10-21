
"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth, UserButton } from "@clerk/nextjs";

const API_URL = "http://localhost:4000";

type Ride = {
  id: string;
  pickup_name: string;
  pickup_lat: number;
  pickup_lng: number;
  dropoff_name: string;
  dropoff_lat: number;
  dropoff_lng: number;
  cab_type: "Mini" | "Sedan" | "XL";
  distance_km: number;
  estimated_fare: number;
  passenger_count: number;
  status: string;
  created_at: string;
  accepted_at?: string | null;
};

type DriverProfile = {
  display_name: string;
  phone: string;
  vehicle_make: string;
  vehicle_model: string;
  vehicle_color: string;
  vehicle_plate: string;
};

const emptyProfile: DriverProfile = {
  display_name: "",
  phone: "",
  vehicle_make: "",
  vehicle_model: "",
  vehicle_color: "",
  vehicle_plate: "",
};

async function readResponse(response: Response) {
  const text = await response.text();
  let result: any;

  try {
    result = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Unexpected server response (HTTP ${response.status}).`);
  }

  if (!response.ok) {
    throw new Error(result.error || `Request failed (HTTP ${response.status}).`);
  }

  return result;
}

export default function DriverPage() {
  const { isLoaded, isSignedIn, getToken } = useAuth();

  const [availableRides, setAvailableRides] = useState<Ride[]>([]);
  const [assignedRides, setAssignedRides] = useState<Ride[]>([]);
  const [profile, setProfile] = useState<DriverProfile>(emptyProfile);
  const [loading, setLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [workingRideId, setWorkingRideId] = useState("");
  const [error, setError] = useState("");
  const [profileMessage, setProfileMessage] = useState("");
  const [message, setMessage] = useState("");
  const [locationMessage, setLocationMessage] = useState("");

  const authorizedFetch = useCallback(
    async (url: string, init: RequestInit = {}) => {
      const token = await getToken();

      if (!token) {
        throw new Error("Please sign in again.");
      }

      const headers = new Headers(init.headers);
      headers.set("Authorization", `Bearer ${token}`);

      if (init.body) {
        headers.set("Content-Type", "application/json");
      }

      return fetch(url, {
        ...init,
        headers,
        cache: "no-store",
      });
    },
    [getToken]
  );

  const loadRides = useCallback(async () => {
    if (!isLoaded || !isSignedIn) return;

    setLoading(true);
    setError("");

    try {
      const [availableResponse, assignedResponse] = await Promise.all([
        authorizedFetch(`${API_URL}/api/driver/rides`),
        authorizedFetch(`${API_URL}/api/driver/rides/assigned`),
      ]);

      const [availableResult, assignedResult] = await Promise.all([
        readResponse(availableResponse),
        readResponse(assignedResponse),
      ]);

      setAvailableRides(availableResult.rides ?? []);
      setAssignedRides(assignedResult.rides ?? []);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not load driver rides."
      );
    } finally {
      setLoading(false);
    }
  }, [isLoaded, isSignedIn, authorizedFetch]);

  const loadProfile = useCallback(async () => {
    if (!isLoaded || !isSignedIn) return;

    setProfileLoading(true);

    try {
      const response = await authorizedFetch(
        `${API_URL}/api/driver/profile`
      );

      const result = await readResponse(response);

      if (result.profile) {
        setProfile({
          display_name: result.profile.display_name ?? "",
          phone: result.profile.phone ?? "",
          vehicle_make: result.profile.vehicle_make ?? "",
          vehicle_model: result.profile.vehicle_model ?? "",
          vehicle_color: result.profile.vehicle_color ?? "",
          vehicle_plate: result.profile.vehicle_plate ?? "",
        });
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not load driver profile."
      );
    } finally {
      setProfileLoading(false);
    }
  }, [isLoaded, isSignedIn, authorizedFetch]);

  useEffect(() => {
    if (!isLoaded) return;

    if (!isSignedIn) {
      window.location.href = "/sign-in?redirect_url=/driver";
      return;
    }

    void loadRides();
    void loadProfile();
  }, [isLoaded, isSignedIn, loadRides, loadProfile]);

  // Refresh ride lists without resetting GPS tracking.
  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;

    const intervalId = window.setInterval(() => {
      void loadRides();
    }, 10000);

    return () => window.clearInterval(intervalId);
  }, [isLoaded, isSignedIn, loadRides]);

  async function saveProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setSavingProfile(true);
    setProfileMessage("");
    setError("");

    try {
      const response = await authorizedFetch(
        `${API_URL}/api/driver/profile`,
        {
          method: "POST",
          body: JSON.stringify({
            displayName: profile.display_name,
            phone: profile.phone,
            vehicleMake: profile.vehicle_make,
            vehicleModel: profile.vehicle_model,
            vehicleColor: profile.vehicle_color,
            vehiclePlate: profile.vehicle_plate,
          }),
        }
      );

      const result = await readResponse(response);

      setProfile({
        display_name: result.profile.display_name ?? "",
        phone: result.profile.phone ?? "",
        vehicle_make: result.profile.vehicle_make ?? "",
        vehicle_model: result.profile.vehicle_model ?? "",
        vehicle_color: result.profile.vehicle_color ?? "",
        vehicle_plate: result.profile.vehicle_plate ?? "",
      });

      setProfileMessage("Driver profile saved successfully.");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not save your profile."
      );
    } finally {
      setSavingProfile(false);
    }
  }

  async function performRideAction(
    rideId: string,
    action: "accept" | "start" | "complete" | "cancel"
  ) {
    if (
      action === "cancel" &&
      !window.confirm("Cancel this accepted ride?")
    ) {
      return;
    }

    setWorkingRideId(rideId);
    setError("");
    setMessage("");

    try {
      const url =
        action === "accept"
          ? `${API_URL}/api/driver/rides/${rideId}/accept`
          : `${API_URL}/api/driver/rides/${rideId}/${action}`;

      const response = await authorizedFetch(url, {
        method: "POST",
      });

      await readResponse(response);

      setMessage(
        action === "accept"
          ? "Ride accepted."
          : action === "start"
            ? "Ride started."
            : action === "complete"
              ? "Ride completed."
              : "Ride cancelled."
      );

      await loadRides();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not update the ride."
      );

      await loadRides();
    } finally {
      setWorkingRideId("");
    }
  }

  // Use only the active ride ID as the tracking effect dependency.
  // Refreshing the assigned rides array will not restart GPS tracking.
  const activeRideId =
    assignedRides.find((ride) => ride.status === "in_progress")?.id ?? null;

  useEffect(() => {
    if (!activeRideId || !isLoaded || !isSignedIn) {
      setLocationMessage("");
      return;
    }

    if (!navigator.geolocation) {
      setLocationMessage("GPS is not supported by this browser.");
      return;
    }

    let disposed = false;
    let lastSentAt = 0;
    let sendingLocation = false;

    setLocationMessage("Waiting for GPS permission...");

    const watchId = navigator.geolocation.watchPosition(
      async (position) => {
        if (disposed || sendingLocation) return;

        const now = Date.now();

        // Limit location updates to at most one request every 3 seconds.
        if (now - lastSentAt < 3000) return;

        sendingLocation = true;
        lastSentAt = now;

        try {
          const response = await authorizedFetch(
            `${API_URL}/api/driver/location`,
            {
              method: "POST",
              body: JSON.stringify({
                rideId: activeRideId,
                latitude: position.coords.latitude,
                longitude: position.coords.longitude,
              }),
            }
          );

          await readResponse(response);

          if (!disposed) {
            setLocationMessage("Sharing your live location.");
          }
        } catch (err) {
          if (!disposed) {
            setLocationMessage(
              err instanceof Error
                ? `Location update failed: ${err.message}`
                : "Could not update your location."
            );
          }
        } finally {
          sendingLocation = false;
        }
      },
      (geoError) => {
        if (disposed) return;

        if (geoError.code === geoError.PERMISSION_DENIED) {
          setLocationMessage(
            "Location permission denied. Allow location access to share your trip."
          );
        } else if (geoError.code === geoError.POSITION_UNAVAILABLE) {
          setLocationMessage("Your current GPS location is unavailable.");
        } else {
          setLocationMessage("GPS timed out. Waiting for another location.");
        }
      },
      {
        enableHighAccuracy: true,
        maximumAge: 5000,
        timeout: 15000,
      }
    );

    return () => {
      disposed = true;
      navigator.geolocation.clearWatch(watchId);

      // Stop sharing the location for this ride when tracking ends.
      void authorizedFetch(
        `${API_URL}/api/driver/location/${activeRideId}`,
        { method: "DELETE" }
      ).catch(() => {
        // Cleanup must not crash the page if the API is unavailable.
      });
    };
  }, [activeRideId, isLoaded, isSignedIn, authorizedFetch]);

  function RideCard({
    ride,
    assigned = false,
  }: {
    ride: Ride;
    assigned?: boolean;
  }) {
    return (
      <article className="rounded-2xl border border-white/10 bg-slate-900 p-5">
        <div className="mb-4 flex items-start justify-between gap-3">
          <span className="rounded-full bg-slate-800 px-3 py-1 text-xs font-semibold text-slate-300">
            {ride.cab_type}
          </span>

          <span className="rounded-full bg-cyan-400/10 px-3 py-1 text-xs font-semibold text-cyan-200">
            {ride.status.replace("_", " ")}
          </span>
        </div>

        <div className="space-y-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">
              Pickup
            </p>
            <p className="font-medium">{ride.pickup_name}</p>
          </div>

          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">
              Drop-off
            </p>
            <p className="font-medium">{ride.dropoff_name}</p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-3 rounded-xl bg-slate-800/70 p-3">
          <div>
            <p className="text-xs text-slate-400">Distance</p>
            <p className="font-semibold">
              {Number(ride.distance_km).toFixed(1)} km
            </p>
          </div>

          <div>
            <p className="text-xs text-slate-400">Passengers</p>
            <p className="font-semibold">{ride.passenger_count}</p>
          </div>

          <div>
            <p className="text-xs text-slate-400">Fare</p>
            <p className="font-semibold">
              ₹{Number(ride.estimated_fare).toFixed(0)}
            </p>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          {!assigned && ride.status === "requested" && (
            <button
              onClick={() => void performRideAction(ride.id, "accept")}
              disabled={workingRideId !== ""}
              className="w-full rounded-xl bg-cyan-400 px-4 py-3 font-bold text-slate-950 hover:bg-cyan-300 disabled:opacity-50"
            >
              {workingRideId === ride.id ? "Please wait..." : "Accept ride"}
            </button>
          )}

          {assigned && ride.status === "accepted" && (
            <>
              <button
                onClick={() => void performRideAction(ride.id, "start")}
                disabled={workingRideId !== ""}
                className="flex-1 rounded-xl bg-blue-500 px-4 py-3 font-bold text-white hover:bg-blue-400 disabled:opacity-50"
              >
                {workingRideId === ride.id ? "Please wait..." : "Start ride"}
              </button>

              <button
                onClick={() => void performRideAction(ride.id, "cancel")}
                disabled={workingRideId !== ""}
                className="flex-1 rounded-xl border border-red-400/30 px-4 py-3 font-semibold text-red-300 hover:bg-red-400/10 disabled:opacity-50"
              >
                Cancel ride
              </button>
            </>
          )}

          {assigned && ride.status === "in_progress" && (
            <button
              onClick={() => void performRideAction(ride.id, "complete")}
              disabled={workingRideId !== ""}
              className="w-full rounded-xl bg-emerald-500 px-4 py-3 font-bold text-white hover:bg-emerald-400 disabled:opacity-50"
            >
              {workingRideId === ride.id
                ? "Please wait..."
                : "Complete ride"}
            </button>
          )}
        </div>
      </article>
    );
  }

  const inputClass =
    "mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-4 py-3 text-white outline-none focus:border-cyan-400";

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <header className="border-b border-white/10 bg-slate-900">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
          <Link href="/" className="text-2xl font-bold tracking-tight">
            Ride<span className="text-cyan-400">Now</span>
          </Link>

          <div className="flex items-center gap-4">
            <Link
              href="/my-rides"
              className="text-sm text-slate-300 hover:text-white"
            >
              My rides
            </Link>

            <Link
              href="/"
              className="text-sm text-slate-300 hover:text-white"
            >
              Book a ride
            </Link>

            <UserButton />
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-5 py-10">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="mb-2 text-sm font-semibold uppercase tracking-widest text-cyan-400">
              Driver workspace
            </p>

            <h1 className="text-3xl font-bold sm:text-4xl">
              Driver Dashboard
            </h1>

            <p className="mt-2 text-slate-400">
              Manage your driver details and ride requests.
            </p>
          </div>

          <button
            onClick={() => void loadRides()}
            disabled={loading}
            className="rounded-xl border border-white/15 px-4 py-2.5 text-sm font-semibold hover:bg-white/10 disabled:opacity-50"
          >
            {loading ? "Refreshing..." : "Refresh rides"}
          </button>
        </div>

        {error && (
          <div className="mb-5 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-red-300">
            {error}
          </div>
        )}

        {message && (
          <div className="mb-5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-emerald-300">
            {message}
          </div>
        )}

        {activeRideId && (
          <div className="mb-5 rounded-xl border border-cyan-400/20 bg-cyan-400/5 p-4">
            <p className="font-semibold text-cyan-200">
              Live location sharing
            </p>
            <p className="mt-1 text-sm text-slate-300">
              {locationMessage || "Preparing location sharing..."}
            </p>
          </div>
        )}

        <section className="mb-10 rounded-2xl border border-white/10 bg-slate-900 p-5 sm:p-7">
          <div className="mb-5">
            <h2 className="text-xl font-bold">Driver profile and vehicle</h2>
            <p className="mt-1 text-sm text-slate-400">
              These details are shown to riders after you accept their ride.
            </p>
          </div>

          {profileLoading ? (
            <p className="text-slate-400">Loading your profile...</p>
          ) : (
            <form
              onSubmit={saveProfile}
              className="grid gap-4 sm:grid-cols-2"
            >
              <label className="text-sm text-slate-300">
                Display name *
                <input
                  className={inputClass}
                  value={profile.display_name}
                  onChange={(event) =>
                    setProfile({
                      ...profile,
                      display_name: event.target.value,
                    })
                  }
                  maxLength={80}
                  required
                  placeholder="Name riders should see"
                />
              </label>

              <label className="text-sm text-slate-300">
                Phone number
                <input
                  className={inputClass}
                  value={profile.phone}
                  onChange={(event) =>
                    setProfile({ ...profile, phone: event.target.value })
                  }
                  maxLength={30}
                  type="tel"
                  placeholder="Contact number"
                />
              </label>

              <label className="text-sm text-slate-300">
                Vehicle make
                <input
                  className={inputClass}
                  value={profile.vehicle_make}
                  onChange={(event) =>
                    setProfile({
                      ...profile,
                      vehicle_make: event.target.value,
                    })
                  }
                  maxLength={50}
                  placeholder="e.g. Maruti Suzuki"
                />
              </label>

              <label className="text-sm text-slate-300">
                Vehicle model
                <input
                  className={inputClass}
                  value={profile.vehicle_model}
                  onChange={(event) =>
                    setProfile({
                      ...profile,
                      vehicle_model: event.target.value,
                    })
                  }
                  maxLength={50}
                  placeholder="e.g. Swift"
                />
              </label>

              <label className="text-sm text-slate-300">
                Vehicle colour
                <input
                  className={inputClass}
                  value={profile.vehicle_color}
                  onChange={(event) =>
                    setProfile({
                      ...profile,
                      vehicle_color: event.target.value,
                    })
                  }
                  maxLength={30}
                  placeholder="e.g. White"
                />
              </label>

              <label className="text-sm text-slate-300">
                Vehicle registration number
                <input
                  className={inputClass}
                  value={profile.vehicle_plate}
                  onChange={(event) =>
                    setProfile({
                      ...profile,
                      vehicle_plate: event.target.value,
                    })
                  }
                  maxLength={20}
                  placeholder="e.g. MH 46 AB 1234"
                />
              </label>

              <div className="sm:col-span-2">
                <button
                  type="submit"
                  disabled={savingProfile}
                  className="rounded-xl bg-cyan-400 px-5 py-3 font-bold text-slate-950 hover:bg-cyan-300 disabled:opacity-50"
                >
                  {savingProfile ? "Saving profile..." : "Save driver profile"}
                </button>

                {profileMessage && (
                  <p className="mt-3 text-sm text-emerald-300">
                    {profileMessage}
                  </p>
                )}
              </div>
            </form>
          )}
        </section>

        <section className="mb-10">
          <h2 className="mb-4 text-2xl font-bold">
            Available ride requests
          </h2>

          {loading ? (
            <p className="rounded-2xl border border-white/10 bg-slate-900 p-8 text-slate-400">
              Loading available rides...
            </p>
          ) : availableRides.length === 0 ? (
            <p className="rounded-2xl border border-white/10 bg-slate-900 p-8 text-slate-400">
              No available ride requests right now.
            </p>
          ) : (
            <div className="grid gap-5 md:grid-cols-2">
              {availableRides.map((ride) => (
                <RideCard key={ride.id} ride={ride} />
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 className="mb-4 text-2xl font-bold">Your assigned rides</h2>

          {loading ? (
            <p className="rounded-2xl border border-white/10 bg-slate-900 p-8 text-slate-400">
              Loading assigned rides...
            </p>
          ) : assignedRides.length === 0 ? (
            <p className="rounded-2xl border border-white/10 bg-slate-900 p-8 text-slate-400">
              You have not accepted any rides yet.
            </p>
          ) : (
            <div className="grid gap-5 md:grid-cols-2">
              {assignedRides.map((ride) => (
                <RideCard key={ride.id} ride={ride} assigned />
              ))}
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
