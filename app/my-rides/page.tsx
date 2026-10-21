
"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth, UserButton } from "@clerk/nextjs";

const API_URL = "http://localhost:4000";

type DriverProfile = {
  display_name: string;
  phone: string | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_color: string | null;
  vehicle_plate: string | null;
};

type RideReview = {
  id?: string;
  ride_id?: string;
  rating: number;
  review_text: string | null;
  created_at?: string;
};

type RidePayment = {
  ride_id: string;
  amount: number;
  currency: string;
  status: "pending" | "paid" | "failed" | "cancelled";
};

type Ride = {
  id: string;
  pickup_name: string;
  dropoff_name: string;
  cab_type: "Mini" | "Sedan" | "XL";
  distance_km: number;
  estimated_fare: number;
  passenger_count: number;
  status: string;
  created_at: string;
  driver_id?: string | null;
  driver_profile?: DriverProfile | null;
};

async function readResponse(response: Response) {
  const text = await response.text();
  let result: any;

  try {
    result = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(
      `The server returned an unexpected response (HTTP ${response.status}).`
    );
  }

  if (!response.ok) {
    throw new Error(result.error || `Request failed (HTTP ${response.status}).`);
  }

  return result;
}

function statusClasses(status: string) {
  switch (status) {
    case "requested":
      return "bg-amber-400/10 text-amber-300";
    case "accepted":
      return "bg-cyan-400/10 text-cyan-300";
    case "in_progress":
      return "bg-blue-400/10 text-blue-300";
    case "completed":
      return "bg-emerald-400/10 text-emerald-300";
    case "cancelled":
      return "bg-red-400/10 text-red-300";
    default:
      return "bg-slate-700 text-slate-300";
  }
}

export default function MyRidesPage() {
  const { isLoaded, isSignedIn, getToken } = useAuth();

  const [rides, setRides] = useState<Ride[]>([]);
  const [payments, setPayments] = useState<Record<string, RidePayment>>({});
  const [reviews, setReviews] = useState<Record<string, RideReview>>({});
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [reviewTexts, setReviewTexts] = useState<Record<string, string>>({});
  const [reviewLoading, setReviewLoading] = useState<Record<string, boolean>>({});
  const [reviewErrors, setReviewErrors] = useState<Record<string, string>>({});

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [cancellingId, setCancellingId] = useState("");
  const [payingId, setPayingId] = useState("");

  const loadRides = useCallback(async () => {
    if (!isLoaded || !isSignedIn) return;

    setLoading(true);
    setError("");

    try {
      const token = await getToken();

      if (!token) {
        throw new Error("Your session could not be verified. Please sign in again.");
      }

      const headers = { Authorization: `Bearer ${token}` };

      const response = await fetch(`${API_URL}/api/rides/mine`, {
        headers,
        cache: "no-store",
      });

      const result = await readResponse(response);
      const loadedRides: Ride[] = result.rides ?? [];
      setRides(loadedRides);

      const completedRides = loadedRides.filter(
        (ride) => ride.status === "completed"
      );

      const [paymentResults, reviewResults] = await Promise.all([
        Promise.all(
          completedRides.map(async (ride) => {
            try {
              const paymentResponse = await fetch(
                `${API_URL}/api/payments/ride/${ride.id}`,
                { headers, cache: "no-store" }
              );
              const paymentResult = await readResponse(paymentResponse);

              return {
                rideId: ride.id,
                payment: paymentResult.payment as RidePayment | null,
              };
            } catch {
              return { rideId: ride.id, payment: null };
            }
          })
        ),
        Promise.all(
          completedRides
            .filter((ride) => Boolean(ride.driver_id))
            .map(async (ride) => {
              try {
                const reviewResponse = await fetch(
                  `${API_URL}/api/reviews/ride/${ride.id}`,
                  { headers, cache: "no-store" }
                );
                const reviewResult = await readResponse(reviewResponse);

                return {
                  rideId: ride.id,
                  review: reviewResult.review as RideReview | null,
                };
              } catch {
                return { rideId: ride.id, review: null };
              }
            })
        ),
      ]);

      setPayments((previous) => {
        const next = { ...previous };

        for (const item of paymentResults) {
          if (item.payment) {
            next[item.rideId] = item.payment;
          }
        }

        return next;
      });

      setReviews((previous) => {
        const next = { ...previous };

        for (const item of reviewResults) {
          if (item.review) {
            next[item.rideId] = item.review;
          }
        }

        return next;
      });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not load your ride history."
      );
    } finally {
      setLoading(false);
    }
  }, [isLoaded, isSignedIn, getToken]);

  useEffect(() => {
    if (!isLoaded) return;

    if (!isSignedIn) {
      window.location.href = "/sign-in?redirect_url=/my-rides";
      return;
    }

    void loadRides();
  }, [isLoaded, isSignedIn, loadRides]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);

    if (params.get("payment") === "success") {
      setMessage(
        "You returned from Stripe Checkout. Refresh payment status to confirm the payment."
      );
    } else if (params.get("payment") === "cancelled") {
      setMessage("Checkout was cancelled. You can try paying again.");
    }
  }, []);

  async function cancelRide(rideId: string) {
    if (!window.confirm("Cancel this ride request?")) return;

    setCancellingId(rideId);
    setError("");
    setMessage("");

    try {
      const token = await getToken();

      if (!token) throw new Error("Please sign in again.");

      const response = await fetch(`${API_URL}/api/rides/${rideId}/cancel`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });

      await readResponse(response);
      setMessage("Your ride request has been cancelled.");
      await loadRides();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not cancel this ride.");
      await loadRides();
    } finally {
      setCancellingId("");
    }
  }

  async function payForRide(rideId: string) {
    setPayingId(rideId);
    setError("");
    setMessage("");

    try {
      const token = await getToken();

      if (!token) throw new Error("Please sign in again.");

      const response = await fetch(`${API_URL}/api/payments/checkout`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ rideId }),
      });

      const result = await readResponse(response);

      if (!result.checkoutUrl) {
        throw new Error("Stripe did not return a checkout URL.");
      }

      window.location.href = result.checkoutUrl;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start payment.");
      setPayingId("");
    }
  }

  async function submitReview(rideId: string) {
    const rating = ratings[rideId];

    if (!rating) {
      setReviewErrors((previous) => ({
        ...previous,
        [rideId]: "Please select a star rating before submitting.",
      }));
      return;
    }

    setReviewLoading((previous) => ({ ...previous, [rideId]: true }));
    setReviewErrors((previous) => ({ ...previous, [rideId]: "" }));
    setError("");
    setMessage("");

    try {
      const token = await getToken();

      if (!token) throw new Error("Please sign in again.");

      const response = await fetch(`${API_URL}/api/reviews`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          rideId,
          rating,
          reviewText: (reviewTexts[rideId] ?? "").trim(),
        }),
      });

      const result = await readResponse(response);

      if (!result.review) {
        throw new Error("The server did not return the saved review.");
      }

      setReviews((previous) => ({
        ...previous,
        [rideId]: result.review,
      }));

      setMessage("Thank you! Your driver review has been submitted.");
    } catch (err) {
      setReviewErrors((previous) => ({
        ...previous,
        [rideId]:
          err instanceof Error ? err.message : "Could not submit your review.",
      }));
    } finally {
      setReviewLoading((previous) => ({ ...previous, [rideId]: false }));
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <header className="border-b border-white/10 bg-slate-900">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
          <Link href="/" className="text-2xl font-bold tracking-tight">
            Ride<span className="text-cyan-400">Now</span>
          </Link>

          <div className="flex items-center gap-4">
            <Link href="/driver" className="text-sm text-slate-300 hover:text-white">
              Driver dashboard
            </Link>
            <Link href="/" className="text-sm text-slate-300 hover:text-white">
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
              Your account
            </p>
            <h1 className="text-3xl font-bold sm:text-4xl">My Rides</h1>
            <p className="mt-2 text-slate-400">
              Manage your bookings, payments, and driver reviews.
            </p>
          </div>

          <button
            onClick={() => void loadRides()}
            disabled={loading}
            className="rounded-xl border border-white/15 px-4 py-2.5 text-sm font-semibold hover:bg-white/10 disabled:opacity-50"
          >
            {loading ? "Refreshing..." : "Refresh status"}
          </button>
        </div>

        {message && (
          <div className="mb-5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-emerald-300">
            {message}
          </div>
        )}

        {error && (
          <div className="mb-5 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-red-300">
            <p>{error}</p>
            <button
              onClick={() => void loadRides()}
              className="mt-3 text-sm font-semibold underline"
            >
              Try again
            </button>
          </div>
        )}

        {loading ? (
          <div className="rounded-2xl border border-white/10 bg-slate-900 p-10 text-center text-slate-400">
            Loading your rides...
          </div>
        ) : rides.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-slate-900 p-10 text-center">
            <h2 className="text-xl font-semibold">No rides yet</h2>
            <p className="mt-2 text-slate-400">
              Your bookings will appear here after you book a ride.
            </p>
            <Link
              href="/"
              className="mt-5 inline-block rounded-xl bg-cyan-400 px-5 py-3 font-bold text-slate-950 hover:bg-cyan-300"
            >
              Book a ride
            </Link>
          </div>
        ) : (
          <div className="grid gap-5 md:grid-cols-2">
            {rides.map((ride) => {
              const payment = payments[ride.id];

              return (
                <article
                  key={ride.id}
                  className="rounded-2xl border border-white/10 bg-slate-900 p-5"
                >
                  <div className="mb-5 flex items-start justify-between gap-3">
                    <div>
                      <span className="rounded-full bg-slate-800 px-3 py-1 text-xs font-semibold text-slate-300">
                        {ride.cab_type}
                      </span>
                      <p className="mt-3 text-sm text-slate-400">
                        {new Date(ride.created_at).toLocaleString("en-IN")}
                      </p>
                    </div>

                    <span
                      className={`rounded-full px-3 py-1.5 text-xs font-semibold ${statusClasses(ride.status)}`}
                    >
                      {ride.status.replace("_", " ")}
                    </span>
                  </div>

                  <div className="space-y-4">
                    <div className="flex gap-3">
                      <span className="mt-1 h-3 w-3 shrink-0 rounded-full bg-emerald-400" />
                      <div>
                        <p className="text-xs uppercase tracking-wide text-slate-500">
                          Pickup
                        </p>
                        <p className="font-medium">{ride.pickup_name}</p>
                      </div>
                    </div>

                    <div className="ml-1.5 h-5 border-l border-dashed border-slate-600" />

                    <div className="flex gap-3">
                      <span className="mt-1 h-3 w-3 shrink-0 rounded-full bg-rose-400" />
                      <div>
                        <p className="text-xs uppercase tracking-wide text-slate-500">
                          Drop-off
                        </p>
                        <p className="font-medium">{ride.dropoff_name}</p>
                      </div>
                    </div>
                  </div>

                  <div className="mt-5 grid grid-cols-3 gap-3 rounded-xl bg-slate-800/70 p-3">
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

                  {ride.driver_id &&
                    (ride.status === "accepted" || ride.status === "in_progress") && (
                      <div className="mt-5 rounded-xl border border-cyan-400/20 bg-cyan-400/5 p-4">
                        <h2 className="font-semibold text-cyan-200">Your driver</h2>
                        {ride.driver_profile ? (
                          <div className="mt-3 space-y-2 text-sm">
                            <p>
                              <span className="text-slate-400">Name: </span>
                              {ride.driver_profile.display_name}
                            </p>
                            {ride.driver_profile.phone && (
                              <p>
                                <span className="text-slate-400">Phone: </span>
                                <a
                                  className="text-cyan-300 underline"
                                  href={`tel:${ride.driver_profile.phone}`}
                                >
                                  {ride.driver_profile.phone}
                                </a>
                              </p>
                            )}
                            {(ride.driver_profile.vehicle_make ||
                              ride.driver_profile.vehicle_model) && (
                              <p>
                                <span className="text-slate-400">Vehicle: </span>
                                {[
                                  ride.driver_profile.vehicle_color,
                                  ride.driver_profile.vehicle_make,
                                  ride.driver_profile.vehicle_model,
                                ]
                                  .filter(Boolean)
                                  .join(" ")}
                              </p>
                            )}
                            {ride.driver_profile.vehicle_plate && (
                              <p>
                                <span className="text-slate-400">Registration: </span>
                                <span className="font-semibold tracking-wide">
                                  {ride.driver_profile.vehicle_plate}
                                </span>
                              </p>
                            )}
                          </div>
                        ) : (
                          <p className="mt-2 text-sm text-slate-400">
                            Driver profile details are not available yet.
                          </p>
                        )}
                      </div>
                    )}

                  {ride.status === "requested" && !ride.driver_id && (
                    <button
                      onClick={() => void cancelRide(ride.id)}
                      disabled={cancellingId !== ""}
                      className="mt-5 w-full rounded-xl border border-red-400/30 px-4 py-3 font-semibold text-red-300 hover:bg-red-400/10 disabled:opacity-50"
                    >
                      {cancellingId === ride.id ? "Cancelling..." : "Cancel request"}
                    </button>
                  )}

                  {ride.status === "accepted" && (
                    <p className="mt-5 rounded-xl bg-cyan-400/10 p-3 text-sm text-cyan-200">
                      A driver has accepted your ride. Refresh to check for updates.
                    </p>
                  )}

                  {ride.status === "in_progress" && (
                    <p className="mt-5 rounded-xl bg-blue-400/10 p-3 text-sm text-blue-200">
                      Your trip is in progress.
                    </p>
                  )}

                  {ride.status === "completed" && (
                    <>
                      <div className="mt-5 rounded-xl border border-emerald-400/20 bg-emerald-400/5 p-4">
                        <p className="font-semibold text-emerald-200">
                          Your trip has been completed.
                        </p>

                        <div className="mt-4 border-t border-white/10 pt-4">
                          <h3 className="font-semibold">Payment</h3>

                          {payment?.status === "paid" ? (
                            <p className="mt-2 text-sm text-emerald-300">
                              Payment successful.
                            </p>
                          ) : (
                            <>
                              <p className="mt-2 text-sm text-slate-300">
                                {payment?.status === "failed"
                                  ? "Your previous payment attempt failed. You can try again."
                                  : payment?.status === "cancelled"
                                    ? "Checkout was cancelled. You can try again."
                                    : "Pay securely through Stripe to complete your fare payment."}
                              </p>

                              <button
                                onClick={() => void payForRide(ride.id)}
                                disabled={payingId !== ""}
                                className="mt-3 w-full rounded-xl bg-cyan-400 px-4 py-3 font-bold text-slate-950 hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {payingId === ride.id
                                  ? "Opening secure checkout..."
                                  : "Pay Now"}
                              </button>
                            </>
                          )}
                        </div>
                      </div>

                      {ride.driver_id && (
                        <div className="mt-4 rounded-xl border border-white/10 bg-slate-800/50 p-4">
                          {reviews[ride.id] ? (
                            <>
                              <h3 className="font-semibold">Your review</h3>
                              <p className="mt-2 text-xl tracking-widest text-amber-300">
                                {"★".repeat(reviews[ride.id].rating)}
                                <span className="text-slate-600">
                                  {"★".repeat(5 - reviews[ride.id].rating)}
                                </span>
                              </p>
                              {reviews[ride.id].review_text && (
                                <p className="mt-2 text-sm text-slate-300">
                                  {reviews[ride.id].review_text}
                                </p>
                              )}
                              <p className="mt-2 text-xs text-emerald-300">
                                Review submitted.
                              </p>
                            </>
                          ) : (
                            <>
                              <h3 className="font-semibold">Rate your driver</h3>
                              <p className="mt-1 text-sm text-slate-400">
                                Select a rating from one to five stars.
                              </p>

                              <div className="mt-3 flex gap-2" role="group" aria-label="Driver rating">
                                {[1, 2, 3, 4, 5].map((star) => (
                                  <button
                                    key={star}
                                    type="button"
                                    onClick={() =>
                                      setRatings((previous) => ({
                                        ...previous,
                                        [ride.id]: star,
                                      }))
                                    }
                                    aria-label={`${star} star${star === 1 ? "" : "s"}`}
                                    aria-pressed={ratings[ride.id] === star}
                                    className={`text-3xl ${
                                      star <= (ratings[ride.id] ?? 0)
                                        ? "text-amber-300"
                                        : "text-slate-600 hover:text-amber-200"
                                    }`}
                                  >
                                    ★
                                  </button>
                                ))}
                              </div>

                              <label
                                htmlFor={`review-${ride.id}`}
                                className="mt-4 block text-sm font-medium text-slate-300"
                              >
                                Comment (optional)
                              </label>
                              <textarea
                                id={`review-${ride.id}`}
                                value={reviewTexts[ride.id] ?? ""}
                                onChange={(event) =>
                                  setReviewTexts((previous) => ({
                                    ...previous,
                                    [ride.id]: event.target.value.slice(0, 1000),
                                  }))
                                }
                                maxLength={1000}
                                rows={3}
                                placeholder="Share your experience..."
                                className="mt-2 w-full resize-y rounded-xl border border-white/10 bg-slate-950 px-3 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-cyan-400"
                              />

                              {reviewErrors[ride.id] && (
                                <p className="mt-3 text-sm text-red-300">
                                  {reviewErrors[ride.id]}
                                </p>
                              )}

                              <button
                                type="button"
                                onClick={() => void submitReview(ride.id)}
                                disabled={Boolean(reviewLoading[ride.id])}
                                className="mt-3 w-full rounded-xl bg-cyan-400 px-4 py-3 font-bold text-slate-950 hover:bg-cyan-300 disabled:opacity-50"
                              >
                                {reviewLoading[ride.id]
                                  ? "Submitting review..."
                                  : "Submit review"}
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </>
                  )}

                  {ride.status === "cancelled" && (
                    <p className="mt-5 rounded-xl bg-red-400/10 p-3 text-sm text-red-200">
                      This ride was cancelled.
                    </p>
                  )}
                </article>
              );
            })}
          </div>
        )}

        <p className="mt-8 text-center text-xs text-slate-500">
          RideNow · Refresh status to retrieve the latest saved trip information.
        </p>
      </section>
    </main>
  );
}
