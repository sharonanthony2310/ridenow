
import type { Express, Request, Response } from "express";
import { getAuth } from "@clerk/express";
import { supabase } from "./supabase";

function getUserId(req: Request): string | null {
  const auth = getAuth(req);
  return auth.isAuthenticated ? auth.userId : null;
}

function isValidRideId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value
    )
  );
}

export function registerReviewRoutes(app: Express): void {
  // Passenger: submit one review for their own completed ride.
  app.post(
    "/api/reviews",
    async (req: Request, res: Response): Promise<void> => {
      const passengerId = getUserId(req);

      if (!passengerId) {
        res.status(401).json({ error: "Please sign in first." });
        return;
      }

      const { rideId, rating, reviewText } = req.body ?? {};

      if (!isValidRideId(rideId)) {
        res.status(400).json({ error: "A valid ride ID is required." });
        return;
      }

      if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        res.status(400).json({
          error: "Rating must be a whole number between 1 and 5.",
        });
        return;
      }

      if (
        reviewText !== undefined &&
        reviewText !== null &&
        (typeof reviewText !== "string" || reviewText.trim().length > 1000)
      ) {
        res.status(400).json({
          error: "Review must be text with a maximum of 1000 characters.",
        });
        return;
      }

      try {
        const { data: ride, error: rideError } = await supabase
          .from("rides")
          .select("id, user_id, driver_id, status")
          .eq("id", rideId)
          .eq("user_id", passengerId)
          .maybeSingle();

        if (rideError) throw rideError;

        if (!ride) {
          res.status(404).json({
            error: "Ride not found or you do not have permission to review it.",
          });
          return;
        }

        if (ride.status !== "completed" || !ride.driver_id) {
          res.status(400).json({
            error: "You can review only a completed ride with an assigned driver.",
          });
          return;
        }

        const { data: existing, error: existingError } = await supabase
          .from("ride_reviews")
          .select("id")
          .eq("ride_id", rideId)
          .maybeSingle();

        if (existingError) throw existingError;

        if (existing) {
          res.status(409).json({
            error: "You have already reviewed this ride.",
          });
          return;
        }

        const { data: review, error: insertError } = await supabase
          .from("ride_reviews")
          .insert({
            ride_id: rideId,
            passenger_id: passengerId,
            driver_id: ride.driver_id,
            rating,
            review_text:
              typeof reviewText === "string" && reviewText.trim()
                ? reviewText.trim()
                : null,
          })
          .select(
            "id, ride_id, passenger_id, driver_id, rating, review_text, created_at"
          )
          .single();

        if (insertError) {
          if (insertError.code === "23505") {
            res.status(409).json({
              error: "This ride already has a review.",
            });
            return;
          }

          throw insertError;
        }

        res.status(201).json({
          message: "Thank you for your review!",
          review,
        });
      } catch (error) {
        console.error("Review submission failed:", error);
        res.status(500).json({
          error: "Could not submit your review.",
        });
      }
    }
  );

  // Passenger: check whether they have reviewed a specific ride.
  app.get(
    "/api/reviews/ride/:rideId",
    async (req: Request, res: Response): Promise<void> => {
      const passengerId = getUserId(req);

      if (!passengerId) {
        res.status(401).json({ error: "Please sign in first." });
        return;
      }

      const rideId = req.params.rideId;

      if (!isValidRideId(rideId)) {
        res.status(400).json({ error: "Invalid ride ID." });
        return;
      }

      try {
        const { data: ride, error: rideError } = await supabase
          .from("rides")
          .select("id")
          .eq("id", rideId)
          .eq("user_id", passengerId)
          .maybeSingle();

        if (rideError) throw rideError;

        if (!ride) {
          res.status(404).json({ error: "Ride not found." });
          return;
        }

        const { data: review, error } = await supabase
          .from("ride_reviews")
          .select("id, ride_id, rating, review_text, created_at")
          .eq("ride_id", rideId)
          .eq("passenger_id", passengerId)
          .maybeSingle();

        if (error) throw error;

        res.json({ review: review ?? null });
      } catch (error) {
        console.error("Ride review lookup failed:", error);
        res.status(500).json({
          error: "Could not retrieve the review.",
        });
      }
    }
  );

  // Public driver rating summary and reviews.
  app.get(
    "/api/reviews/driver/:driverId",
    async (req: Request, res: Response): Promise<void> => {
      const driverId = req.params.driverId;

      if (
        typeof driverId !== "string" ||
        driverId.length < 1 ||
        driverId.length > 256
      ) {
        res.status(400).json({ error: "Invalid driver ID." });
        return;
      }

      try {
        const { data: reviews, error } = await supabase
          .from("ride_reviews")
          .select("id, rating, review_text, created_at")
          .eq("driver_id", driverId)
          .order("created_at", { ascending: false });

        if (error) throw error;

        const items = reviews ?? [];
        const averageRating =
          items.length > 0
            ? Number(
                (
                  items.reduce((sum, item) => sum + item.rating, 0) /
                  items.length
                ).toFixed(1)
              )
            : null;

        res.json({
          driverId,
          averageRating,
          reviewCount: items.length,
          reviews: items,
        });
      } catch (error) {
        console.error("Driver reviews lookup failed:", error);
        res.status(500).json({
          error: "Could not retrieve driver reviews.",
        });
      }
    }
  );
}
